import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  CreateLocationDto,
  CreateTrackerDto,
} from './dto/tracker.dto';

@Injectable()
export class TrackersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(user: AuthUser) {
    return this.prisma.tracker.findMany({
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
    const data = {
      organisationId: user.organisationId,
      serialNumber,
      provider,
    };
    try {
      if (simulated) return await this.prisma.tracker.create({ data });
      const key = imeiKey(serialNumber);
      return await lockedTransaction(this.prisma, imeiLock(key), async (tx) => {
        const claimed = await tx.$queryRaw<unknown[]>`
          SELECT 1 FROM "Tracker"
          WHERE ${realProviderSql} AND ${imeiKeySql} = ${key} LIMIT 1`;
        if (claimed.length > 0) throw this.alreadyRegistered();
        return tx.tracker.create({ data });
      });
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
        const previousOnJob = await tx.trackerAssignment.findMany({
          where: { importJobId: job.id, removedAt: null },
        });
        await tx.trackerAssignment.updateMany({
          where: {
            organisationId: user.organisationId,
            removedAt: null,
            OR: [{ trackerId: tracker.id }, { importJobId: job.id }],
          },
          data: { removedAt: new Date() },
        });
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

  async unassign(user: AuthUser, assignmentId: string) {
    const { assignment, updated } = await lockedTransaction(
      this.prisma,
      trackerLock(user.organisationId),
      async (tx) => {
        const assignment = await tx.trackerAssignment.findFirst({
          where: { id: assignmentId, organisationId: user.organisationId },
        });
        if (!assignment) {
          throw new NotFoundException('Assignment not found');
        }
        if (assignment.removedAt) {
          throw new BadRequestException('Tracker already removed');
        }
        const updated = await tx.trackerAssignment.update({
          where: { id: assignmentId },
          data: { removedAt: new Date() },
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
      },
    });
    return updated;
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
      { keepUnassigned: true },
    );
    return this.prisma.locationEvent.findFirstOrThrow({
      where: { trackerId: tracker.id, recordedAt, isDuplicate: false },
    });
  }
}
