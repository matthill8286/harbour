import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Tracker } from '@prisma/client';
import {
  needsFitter,
  TRACKER_STATEMENT_VERSION,
  trackerSignal,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { lockedTransaction, trackerLock } from '../prisma/locked-transaction';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import {
  imeiKey,
  imeiKeySql,
  imeiLock,
  realProviderSql,
} from '../integrations/gps-device';
import {
  DEFAULT_GPS_PROVIDER,
  isSimulatedGpsProvider,
} from '../integrations/gps-providers';
import { savePings } from '../tracking/location-writes';
import {
  AssignTrackerDto,
  ConfirmRemovalDto,
  CreateLocationDto,
  CreateTrackerDto,
  TrackerDetailsDto,
  UnassignTrackerDto,
  UpdateTrackerDto,
} from './dto/tracker.dto';

/** The person who fitted or removed a unit, trimmed, or null. */
const fitterName = (value: string | undefined) => value?.trim() || null;

/** The fields a details form may set, as stored. */
function detailsData(dto: TrackerDetailsDto) {
  return {
    ...(dto.powerSource ? { powerSource: dto.powerSource } : {}),
    ...(dto.reportIntervalMinutes
      ? { reportIntervalMinutes: dto.reportIntervalMinutes }
      : {}),
    ...(dto.fittedBy !== undefined
      ? { fittedBy: fitterName(dto.fittedBy) }
      : {}),
    ...(dto.fittedAt !== undefined
      ? { fittedAt: dto.fittedAt ? new Date(dto.fittedAt) : null }
      : {}),
    ...(dto.ownerPermissionHeld !== undefined
      ? { ownerPermissionHeld: dto.ownerPermissionHeld }
      : {}),
  };
}

/**
 * A hard-wired or diagnostic-port unit changes the vehicle, so it goes on a
 * job only once a fitter is named and the owner's written permission is held.
 */
function assertFitted(
  tracker: Pick<
    Tracker,
    'provider' | 'powerSource' | 'fittedBy' | 'ownerPermissionHeld'
  >,
) {
  if (isSimulatedGpsProvider(tracker.provider)) return;
  if (!needsFitter(tracker.powerSource)) return;
  if (!tracker.fittedBy || !tracker.ownerPermissionHeld) {
    throw new BadRequestException(
      'A hard-wired or diagnostic-port unit needs the fitter’s name and the vehicle owner’s written permission before it goes on a job.',
    );
  }
}

@Injectable()
export class TrackersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    const trackers = await this.prisma.tracker.findMany({
      where: { organisationId: user.organisationId },
      include: {
        assignments: {
          where: { removedAt: null },
          include: {
            importJob: { select: { id: true, reference: true } },
            vehicle: {
              select: { make: true, model: true, ukRegistration: true },
            },
          },
        },
      },
      orderBy: { serialNumber: 'asc' },
    });
    const now = new Date();
    return trackers.map((tracker) => ({
      ...tracker,
      signal: trackerSignal(tracker, now),
    }));
  }

  /**
   * Registers a unit. A real IMEI can be registered once on the whole platform.
   * Registering it is only a claim: no gateway position reaches the tracker
   * until the platform operator confirms who owns the unit.
   */
  async create(user: AuthUser, dto: CreateTrackerDto) {
    const provider = dto.provider?.trim().toLowerCase() || DEFAULT_GPS_PROVIDER;
    const simulated = isSimulatedGpsProvider(provider);
    const serialNumber = simulated
      ? dto.serialNumber.trim()
      : dto.serialNumber.replace(/[\s-]+/g, '');
    if (!serialNumber) {
      throw new BadRequestException('Enter the serial number or IMEI');
    }
    if (!simulated) {
      if (!dto.statementConfirmed) {
        throw new BadRequestException(
          'Confirm the statement about lawful use before you register a real unit.',
        );
      }
      if (dto.statementVersion !== TRACKER_STATEMENT_VERSION) {
        throw new BadRequestException(
          'The statement has changed since this page loaded. Reload the page and read it again.',
        );
      }
    }
    const data = {
      organisationId: user.organisationId,
      serialNumber,
      provider,
      ...detailsData(dto),
      ...(simulated
        ? {}
        : {
            statementConfirmedAt: new Date(),
            statementConfirmedById: user.id,
            statementVersion: TRACKER_STATEMENT_VERSION,
          }),
    };
    try {
      const tracker = simulated
        ? await this.prisma.tracker.create({ data })
        : await lockedTransaction(
            this.prisma,
            imeiLock(imeiKey(serialNumber)),
            async (tx) => {
              const key = imeiKey(serialNumber);
              const claimed = await tx.$queryRaw<unknown[]>`
                SELECT 1 FROM "Tracker"
                WHERE ${realProviderSql} AND ${imeiKeySql} = ${key} LIMIT 1`;
              if (claimed.length > 0) throw this.alreadyRegistered();
              return tx.tracker.create({ data });
            },
          );
      void this.audit.record(user, {
        action: 'TRACKER_REGISTERED',
        entityType: 'Tracker',
        entityId: tracker.id,
        metadata: {
          serialNumber: tracker.serialNumber,
          provider: tracker.provider,
          powerSource: tracker.powerSource,
          reportIntervalMinutes: tracker.reportIntervalMinutes,
          statementVersion: tracker.statementVersion,
        },
      });
      return tracker;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.alreadyRegistered();
      }
      throw error;
    }
  }

  /** Changes how a unit is powered, fitted or set to report. */
  async update(user: AuthUser, trackerId: string, dto: UpdateTrackerDto) {
    const tracker = await this.prisma.tracker.findFirst({
      where: { id: trackerId, organisationId: user.organisationId },
    });
    if (!tracker) {
      throw new NotFoundException('Tracker not found');
    }
    const data = detailsData(dto);
    const updated = await this.prisma.tracker.update({
      where: { id: tracker.id },
      data,
    });
    void this.audit.record(user, {
      action: 'TRACKER_DETAILS_UPDATED',
      entityType: 'Tracker',
      entityId: tracker.id,
      metadata: {
        serialNumber: tracker.serialNumber,
        fields: Object.keys(data),
        powerSource: updated.powerSource,
        reportIntervalMinutes: updated.reportIntervalMinutes,
      },
    });
    return { ...updated, signal: trackerSignal(updated) };
  }

  private alreadyRegistered() {
    return new ConflictException(
      'This unit is already registered. If it is yours, contact support.',
    );
  }

  /**
   * Puts a tracker on a job. A tracker is on one job at a time and a job has one
   * tracker, so the old assignments end in the same transaction.
   */
  async assign(user: AuthUser, jobId: string, dto: AssignTrackerDto) {
    const { assignment, tracker } = await lockedTransaction(
      this.prisma,
      trackerLock(user.organisationId),
      async (tx) => {
        const job = await tx.importJob.findFirst({
          where: { id: jobId, organisationId: user.organisationId },
        });
        if (!job) {
          throw new NotFoundException('Import job not found');
        }
        const tracker = await tx.tracker.findFirst({
          where: { id: dto.trackerId, organisationId: user.organisationId },
        });
        if (!tracker) {
          throw new NotFoundException('Tracker not found');
        }
        assertFitted(tracker);
        const previousOnJob = await tx.trackerAssignment.findMany({
          where: { importJobId: job.id, removedAt: null },
        });
        // A real unit that comes off a vehicle must be confirmed as taken out.
        const ending = await tx.trackerAssignment.findMany({
          where: {
            organisationId: user.organisationId,
            removedAt: null,
            OR: [{ trackerId: tracker.id }, { importJobId: job.id }],
          },
          select: { id: true, tracker: { select: { provider: true } } },
        });
        const endedAt = new Date();
        for (const real of [true, false]) {
          const ids = ending
            .filter(
              (item) => !isSimulatedGpsProvider(item.tracker.provider) === real,
            )
            .map((item) => item.id);
          if (ids.length === 0) continue;
          await tx.trackerAssignment.updateMany({
            where: { id: { in: ids } },
            data: { removedAt: endedAt, removalRequired: real },
          });
        }
        const previousTrackerIds = previousOnJob
          .map((item) => item.trackerId)
          .filter((id) => id !== tracker.id);
        if (previousTrackerIds.length > 0) {
          await tx.tracker.updateMany({
            where: { id: { in: previousTrackerIds } },
            data: { status: 'AVAILABLE' },
          });
        }
        const assignment = await tx.trackerAssignment.create({
          data: {
            organisationId: user.organisationId,
            trackerId: tracker.id,
            vehicleId: job.vehicleId,
            importJobId: job.id,
          },
          include: { tracker: true },
        });
        await tx.tracker.update({
          where: { id: tracker.id },
          data: { status: 'ASSIGNED' },
        });
        return { assignment, tracker };
      },
    );
    void this.audit.record(user, {
      action: 'TRACKER_ASSIGNED',
      entityType: 'Tracker',
      entityId: tracker.id,
      metadata: {
        importJobId: assignment.importJobId,
        serialNumber: tracker.serialNumber,
      },
    });
    return assignment;
  }

  /**
   * Takes a unit off its job. A real unit must also be confirmed as taken out
   * of the vehicle, now or later, so that it cannot go on tracking whoever has
   * the vehicle next.
   */
  async unassign(
    user: AuthUser,
    assignmentId: string,
    dto: UnassignTrackerDto = {},
  ) {
    const { assignment, updated } = await lockedTransaction(
      this.prisma,
      trackerLock(user.organisationId),
      async (tx) => {
        const assignment = await tx.trackerAssignment.findFirst({
          where: { id: assignmentId, organisationId: user.organisationId },
          include: { tracker: true },
        });
        if (!assignment) {
          throw new NotFoundException('Assignment not found');
        }
        if (assignment.removedAt) {
          throw new BadRequestException('Tracker already removed');
        }
        const real = !isSimulatedGpsProvider(assignment.tracker.provider);
        const removal =
          real && dto.unitRemoved
            ? this.removalData(user, assignment.tracker, dto.removalFitter)
            : {};
        const updated = await tx.trackerAssignment.update({
          where: { id: assignmentId },
          data: { removedAt: new Date(), removalRequired: real, ...removal },
        });
        await tx.tracker.update({
          where: { id: assignment.trackerId },
          data: { status: 'AVAILABLE' },
        });
        return { assignment, updated };
      },
    );
    void this.audit.record(user, {
      action: 'TRACKER_UNASSIGNED',
      entityType: 'TrackerAssignment',
      entityId: assignment.id,
      metadata: {
        importJobId: assignment.importJobId,
        trackerId: assignment.trackerId,
        unitRemoved: Boolean(updated.removalConfirmedAt),
      },
    });
    return updated;
  }

  /** Records that a unit that came off a job has been taken out of the vehicle. */
  async confirmRemoval(
    user: AuthUser,
    assignmentId: string,
    dto: ConfirmRemovalDto,
  ) {
    const assignment = await this.prisma.trackerAssignment.findFirst({
      where: { id: assignmentId, organisationId: user.organisationId },
      include: { tracker: true },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    if (!assignment.removedAt) {
      throw new BadRequestException(
        'Take the tracker off the job before you confirm it was removed.',
      );
    }
    if (assignment.removalConfirmedAt) return assignment;
    const updated = await this.prisma.trackerAssignment.update({
      where: { id: assignment.id },
      data: this.removalData(user, assignment.tracker, dto.removalFitter),
    });
    void this.audit.record(user, {
      action: 'TRACKER_REMOVAL_CONFIRMED',
      entityType: 'TrackerAssignment',
      entityId: assignment.id,
      metadata: {
        importJobId: assignment.importJobId,
        trackerId: assignment.trackerId,
        removalFitter: updated.removalFitter,
      },
    });
    return updated;
  }

  /** A hard-wired or diagnostic-port unit is taken out by a named fitter. */
  private removalData(
    user: AuthUser,
    tracker: Pick<Tracker, 'powerSource'>,
    fitter: string | undefined,
  ) {
    const removalFitter = fitterName(fitter);
    if (needsFitter(tracker.powerSource) && !removalFitter) {
      throw new BadRequestException(
        'Give the name of the fitter who took out the unit and restored the wiring.',
      );
    }
    return {
      removalConfirmedAt: new Date(),
      removalConfirmedById: user.id,
      removalFitter,
    };
  }

  /** A position typed in by staff, for a tracker of their own workspace. */
  async addLocation(user: AuthUser, trackerId: string, dto: CreateLocationDto) {
    const tracker = await this.prisma.tracker.findFirst({
      where: { id: trackerId, organisationId: user.organisationId },
    });
    if (!tracker) {
      throw new NotFoundException('Tracker not found');
    }
    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : new Date();
    await savePings(
      this.prisma,
      [{ tracker, pings: [{ ...dto, recordedAt }] }],
      { keepUnassigned: true, source: 'MANUAL' },
    );
    return this.prisma.locationEvent.findFirstOrThrow({
      where: { trackerId: tracker.id, recordedAt, isDuplicate: false },
    });
  }
}
