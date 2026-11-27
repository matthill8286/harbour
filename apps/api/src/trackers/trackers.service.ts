import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { lockedTransaction, trackerLock } from '../prisma/locked-transaction';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
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

  create(user: AuthUser, dto: CreateTrackerDto) {
    return this.prisma.tracker.create({
      data: {
        organisationId: user.organisationId,
        serialNumber: dto.serialNumber.trim(),
        provider: (dto.provider ?? 'generic').trim().toLowerCase() || 'generic',
      },
    });
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

  async addLocation(user: AuthUser, trackerId: string, dto: CreateLocationDto) {
    const tracker = await this.prisma.tracker.findFirst({
      where: { id: trackerId, organisationId: user.organisationId },
      include: { assignments: { where: { removedAt: null }, take: 1 } },
    });
    if (!tracker) {
      throw new NotFoundException('Tracker not found');
    }
    const assignment = tracker.assignments[0];
    const event = await this.prisma.locationEvent.create({
      data: {
        organisationId: user.organisationId,
        trackerId: tracker.id,
        vehicleId: assignment?.vehicleId,
        importJobId: assignment?.importJobId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy,
        speed: dto.speed,
        heading: dto.heading,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
      },
    });
    await this.prisma.tracker.update({
      where: { id: tracker.id },
      data: { lastSeenAt: event.recordedAt, status: 'ASSIGNED' },
    });
    return event;
  }
}
