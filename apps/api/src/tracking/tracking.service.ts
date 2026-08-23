import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { LocationEvent } from '@prisma/client';
import {
  bearingDegrees,
  journeyStatusesForJob,
  type JobStatus,
  type LocationPoint,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GpsProviderService } from '../integrations/gps-provider.service';
import { MapsService } from '../integrations/maps.service';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gps: GpsProviderService,
    private readonly maps: MapsService,
  ) {}

  async live(user: AuthUser) {
    const jobs = await this.prisma.importJob.findMany({
      where: {
        organisationId: user.organisationId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        vehicle: { select: { make: true, model: true, ukRegistration: true } },
        trackerAssignments: {
          where: { removedAt: null },
          include: { tracker: true },
          take: 1,
        },
        locationEvents: { orderBy: { recordedAt: 'desc' }, take: 80 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      map: this.maps.getConfig(),
      vehicles: jobs.map((job) => this.toVehicleTracking(job, true)),
    };
  }

  async forJob(user: AuthUser, jobId: string, customerView = false) {
    if (customerView && user.customerId == null) {
      throw new ForbiddenException('No customer profile linked to this account');
    }
    const job = await this.prisma.importJob.findFirst({
      where: {
        id: jobId,
        organisationId: user.organisationId,
        ...(customerView ? { customerId: user.customerId ?? undefined } : {}),
      },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        vehicle: { select: { make: true, model: true, ukRegistration: true } },
        trackerAssignments: {
          where: { removedAt: null },
          include: { tracker: true },
          take: 1,
        },
        locationEvents: { orderBy: { recordedAt: 'desc' }, take: 300 },
      },
    });
    if (!job) {
      throw new NotFoundException('Import job not found');
    }
    await this.alignToStatus(job.id, job.organisationId, job.status as JobStatus);
    const aligned = await this.prisma.importJob.findFirst({
      where: { id: job.id },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        vehicle: { select: { make: true, model: true, ukRegistration: true } },
        trackerAssignments: {
          where: { removedAt: null },
          include: { tracker: true },
          take: 1,
        },
        locationEvents: { orderBy: { recordedAt: 'desc' }, take: 300 },
      },
    });
    const tracking = this.toVehicleTracking(aligned ?? job, !customerView);
    if (customerView) {
      return { map: this.maps.getConfig(), ...tracking };
    }
    const availableTrackers = await this.prisma.tracker.findMany({
      where: { organisationId: user.organisationId, status: { in: ['AVAILABLE', 'OFFLINE'] } },
      orderBy: { serialNumber: 'asc' },
    });
    return {
      map: this.maps.getConfig(),
      ...tracking,
      availableTrackers: availableTrackers.map((tracker) => ({
        id: tracker.id,
        serialNumber: tracker.serialNumber,
        status: tracker.status,
        batteryLevel: tracker.batteryLevel,
      })),
    };
  }

  async advance(user: AuthUser, jobId: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, organisationId: user.organisationId },
      include: {
        trackerAssignments: { where: { removedAt: null }, include: { tracker: true }, take: 1 },
        locationEvents: { orderBy: { recordedAt: 'desc' }, take: 1 },
      },
    });
    if (!job) {
      throw new NotFoundException('Import job not found');
    }
    const assignment = job.trackerAssignments[0];
    if (!assignment) {
      throw new NotFoundException('No tracker assigned to this job');
    }
    const last = job.locationEvents[0];
    const next = this.gps.nextPoint(
      last
        ? { latitude: Number(last.latitude), longitude: Number(last.longitude) }
        : null,
    );
    // Append after the latest trail ping. Wall-clock "now" can fall in the
    // middle of a seeded historical journey and close the polyline on itself.
    const recordedAt = last
      ? new Date(last.recordedAt.getTime() + 5 * 60 * 1000)
      : new Date();
    const event = await this.prisma.locationEvent.create({
      data: {
        organisationId: user.organisationId,
        trackerId: assignment.trackerId,
        vehicleId: job.vehicleId,
        importJobId: job.id,
        latitude: next.latitude,
        longitude: next.longitude,
        accuracy: next.accuracy,
        speed: next.speed,
        heading: next.heading,
        recordedAt,
      },
    });
    await this.prisma.tracker.update({
      where: { id: assignment.trackerId },
      data: {
        lastSeenAt: event.recordedAt,
        status: 'ASSIGNED',
        batteryLevel: Math.max(12, (assignment.tracker.batteryLevel ?? 80) - 1),
      },
    });
    return this.serializePoint(event);
  }

  mapConfig() {
    return this.maps.getConfig();
  }

  async alignToStatus(jobId: string, organisationId: string, status: JobStatus) {
    if (status === 'CANCELLED') return;
    await this.syncJourneys(jobId, status);
    await this.catchUpGps(jobId, organisationId, status);
  }

  private async syncJourneys(jobId: string, status: JobStatus) {
    const journeys = await this.prisma.journey.findMany({
      where: { importJobId: jobId },
      orderBy: { createdAt: 'asc' },
    });
    if (journeys.length === 0) return;
    const desired = journeyStatusesForJob(status);
    await Promise.all(
      journeys.slice(0, desired.length).map((journey, index) => {
        const nextStatus = desired[index];
        if (journey.status === nextStatus) return Promise.resolve();
        return this.prisma.journey.update({
          where: { id: journey.id },
          data: {
            status: nextStatus,
            startedAt:
              nextStatus === 'PLANNED'
                ? journey.startedAt
                : journey.startedAt ?? new Date(),
            completedAt: nextStatus === 'COMPLETED' ? journey.completedAt ?? new Date() : null,
          },
        });
      }),
    );
  }

  private async catchUpGps(jobId: string, organisationId: string, status: JobStatus) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, organisationId },
      include: {
        trackerAssignments: { where: { removedAt: null }, take: 1 },
        locationEvents: { orderBy: { recordedAt: 'desc' }, take: 1 },
      },
    });
    if (!job?.trackerAssignments[0]) return;
    const last = job.locationEvents[0];
    const points = this.gps.pointsTowardAnchor(
      status,
      last ? { latitude: Number(last.latitude), longitude: Number(last.longitude) } : null,
    );
    if (points.length === 0) return;
    let recordedAt = last ? last.recordedAt.getTime() : Date.now();
    for (const [index, point] of points.entries()) {
      recordedAt += 5 * 60 * 1000;
      const towards = points[index + 1] ?? point;
      await this.prisma.locationEvent.create({
        data: {
          organisationId,
          trackerId: job.trackerAssignments[0].trackerId,
          vehicleId: job.vehicleId,
          importJobId: job.id,
          latitude: point.latitude,
          longitude: point.longitude,
          accuracy: 10,
          speed: status === 'SHIPPING_TO_CYPRUS' || status === 'ARRIVED_CYPRUS' ? 18 : 72,
          heading: Math.round(bearingDegrees(point, towards) % 360),
          recordedAt: new Date(recordedAt),
        },
      });
    }
  }

  private toVehicleTracking(
    job: {
      id: string;
      reference: string;
      status: string;
      customer: { firstName: string; lastName: string };
      vehicle: { make: string | null; model: string | null; ukRegistration: string | null };
      trackerAssignments: Array<{
        id: string;
        assignedAt: Date;
        tracker: {
          id: string;
          serialNumber: string;
          batteryLevel: number | null;
          lastSeenAt: Date | null;
          status: string;
        };
      }>;
      locationEvents: LocationEvent[];
    },
    includeTracker: boolean,
  ) {
    const trail = [...job.locationEvents]
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
      .map((event) => this.serializePoint(event));
    const assignment = job.trackerAssignments[0] ?? null;
    return {
      importJobId: job.id,
      reference: job.reference,
      status: job.status,
      customer: job.customer,
      vehicle: job.vehicle,
      current: trail[trail.length - 1] ?? null,
      trail,
      tracker: includeTracker && assignment
        ? {
            assignmentId: assignment.id,
            assignedAt: assignment.assignedAt,
            id: assignment.tracker.id,
            serialNumber: assignment.tracker.serialNumber,
            batteryLevel: assignment.tracker.batteryLevel,
            lastSeenAt: assignment.tracker.lastSeenAt,
            status: assignment.tracker.status,
          }
        : null,
    };
  }

  private serializePoint(event: LocationEvent): LocationPoint {
    return {
      id: event.id,
      latitude: Number(event.latitude),
      longitude: Number(event.longitude),
      accuracy: event.accuracy == null ? null : Number(event.accuracy),
      speed: event.speed == null ? null : Number(event.speed),
      heading: event.heading == null ? null : Number(event.heading),
      recordedAt: event.recordedAt.toISOString(),
    };
  }
}
