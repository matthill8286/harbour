import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LocationEvent, Prisma } from '@prisma/client';
import {
  bearingDegrees,
  journeyStatusesForJob,
  type JobStatus,
  type LocationPoint,
  UK_CYPRUS_ROUTE_KEY,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { lockedTransaction, trackerLock } from '../prisma/locked-transaction';
import { GpsProviderService } from '../integrations/gps-provider.service';
import { isSimulatedGpsProvider } from '../integrations/gps-providers';
import { DEMO_WORKSPACE_SLUGS } from '../integrations/sample-data';
import { MapsService } from '../integrations/maps.service';
import { plannedRouteForJob } from '../routes/planned-route';
import type { AuthUser } from '../auth/auth.types';

const trackingJobInclude = {
  customer: { select: { firstName: true, lastName: true } },
  vehicle: { select: { make: true, model: true, ukRegistration: true } },
  routeTemplate: true,
  trackerAssignments: {
    where: { removedAt: null },
    include: { tracker: true },
    take: 1,
  },
} as const;

const latestTrail = (take: number) =>
  ({
    where: { isDuplicate: false },
    orderBy: { recordedAt: 'desc' },
    take,
  }) as const;

const PING_GAP_MS = 5 * 60 * 1000;

type Tx = Prisma.TransactionClient;

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
        ...trackingJobInclude,
        locationEvents: latestTrail(80),
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
      throw new ForbiddenException(
        'No customer profile linked to this account',
      );
    }
    const job = await this.prisma.importJob.findFirst({
      where: {
        id: jobId,
        organisationId: user.organisationId,
        ...(customerView ? { customerId: user.customerId ?? undefined } : {}),
      },
      include: {
        ...trackingJobInclude,
        locationEvents: latestTrail(300),
      },
    });
    if (!job) {
      throw new NotFoundException('Import job not found');
    }
    const tracking = this.toVehicleTracking(job, !customerView);
    if (customerView) {
      return { map: this.maps.getConfig(), ...tracking };
    }
    const availableTrackers = await this.prisma.tracker.findMany({
      where: {
        organisationId: user.organisationId,
        status: { in: ['AVAILABLE', 'OFFLINE'] },
      },
      orderBy: { serialNumber: 'asc' },
    });
    return {
      map: this.maps.getConfig(),
      ...tracking,
      availableTrackers: availableTrackers.map((tracker) => ({
        id: tracker.id,
        serialNumber: tracker.serialNumber,
        provider: tracker.provider,
        status: tracker.status,
        batteryLevel: tracker.batteryLevel,
      })),
    };
  }

  /** The explicit "Advance GPS" action on a simulated tracker. */
  async advance(user: AuthUser, jobId: string) {
    // The lock stops two requests, or a reassignment, running alongside.
    return lockedTransaction(
      this.prisma,
      trackerLock(user.organisationId),
      async (tx) => {
        const job = await tx.importJob.findFirst({
          where: { id: jobId, organisationId: user.organisationId },
          include: {
            trackerAssignments: {
              where: { removedAt: null },
              include: { tracker: true },
              take: 1,
            },
          },
        });
        if (!job) {
          throw new NotFoundException('Import job not found');
        }
        const assignment = job.trackerAssignments[0];
        if (!assignment) {
          throw new NotFoundException('No tracker assigned to this job');
        }
        if (!isSimulatedGpsProvider(assignment.tracker.provider)) {
          throw new BadRequestException(
            'Live GPS units cannot use demo Advance GPS',
          );
        }
        const last = await this.latestPing(tx, { importJobId: job.id });
        const lastPoint = last ? this.coordinates(last) : null;
        if (
          this.gps.pointsTowardAnchor(job.status as JobStatus, lastPoint)
            .length === 0
        ) {
          if (!last) {
            throw new BadRequestException('No GPS position to advance');
          }
          return this.serializePoint(last);
        }
        const next = this.gps.nextPoint(lastPoint);
        // Append after the latest trail ping. Wall-clock "now" can fall in the
        // middle of a seeded historical journey and close the polyline on itself.
        const after = await this.latestTime(tx, assignment.trackerId, last);
        const recordedAt = after
          ? new Date(after.getTime() + PING_GAP_MS)
          : new Date();
        const event = await tx.locationEvent.create({
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
        await tx.tracker.update({
          where: { id: assignment.trackerId },
          data: {
            lastSeenAt: event.recordedAt,
            status: 'ASSIGNED',
            batteryLevel: Math.max(
              12,
              (assignment.tracker.batteryLevel ?? 80) - 1,
            ),
          },
        });
        return this.serializePoint(event);
      },
    );
  }

  mapConfig() {
    return this.maps.getConfig();
  }

  /**
   * Call after a job's status changes, never when a job is read. It brings the
   * journeys into line. In the demo workspaces only, it also moves the
   * simulated GPS trail to match, which adds and removes made-up positions.
   */
  async alignToStatus(
    jobId: string,
    organisationId: string,
    status: JobStatus,
  ) {
    if (status === 'CANCELLED') return;
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, organisationId },
      select: {
        route: { select: { systemKey: true } },
        organisation: { select: { slug: true } },
      },
    });
    // Only the seeded UK → Cyprus route's statuses map onto its GPS corridor.
    // A job not yet given a route is on that one.
    if (!job) return;
    if (job.route && job.route.systemKey !== UK_CYPRUS_ROUTE_KEY) return;
    await this.syncJourneys(jobId, status);
    if (!DEMO_WORKSPACE_SLUGS.has(job.organisation.slug)) return;
    await lockedTransaction(this.prisma, trackerLock(organisationId), (tx) =>
      this.simulateToStatus(tx, jobId, organisationId, status),
    );
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
                : (journey.startedAt ?? new Date()),
            completedAt:
              nextStatus === 'COMPLETED'
                ? (journey.completedAt ?? new Date())
                : null,
          },
        });
      }),
    );
  }

  private async simulateToStatus(
    tx: Tx,
    jobId: string,
    organisationId: string,
    status: JobStatus,
  ) {
    const job = await tx.importJob.findFirst({
      where: { id: jobId, organisationId },
      select: {
        vehicleId: true,
        trackerAssignments: {
          where: { removedAt: null },
          select: { trackerId: true, tracker: { select: { provider: true } } },
          take: 1,
        },
      },
    });
    const assignment = job?.trackerAssignments[0];
    // Checked before any ping is loaded: a real unit's trail can be very long.
    if (!job || !assignment) return;
    if (!isSimulatedGpsProvider(assignment.tracker.provider)) return;
    const { trackerId } = assignment;
    await this.trimGpsToStatus(tx, jobId, trackerId, status);
    await this.catchUpGps(
      tx,
      { organisationId, jobId, vehicleId: job.vehicleId, trackerId },
      status,
    );
  }

  /** Only the simulated tracker's own points can be removed. */
  private async trimGpsToStatus(
    tx: Tx,
    jobId: string,
    trackerId: string,
    status: JobStatus,
  ) {
    const trail = await tx.locationEvent.findMany({
      where: { importJobId: jobId, trackerId },
      orderBy: { recordedAt: 'asc' },
    });
    const extra = new Set(
      trail
        .filter((event) =>
          this.gps.isPastAnchor(status, this.coordinates(event)),
        )
        .map((event) => event.id),
    );
    if (extra.size === 0) return;
    await tx.locationEvent.deleteMany({
      where: { id: { in: [...extra] } },
    });
    const lastKept = trail.filter((event) => !extra.has(event.id)).pop();
    await tx.tracker.update({
      where: { id: trackerId },
      data: { lastSeenAt: lastKept?.recordedAt ?? null },
    });
  }

  private async catchUpGps(
    tx: Tx,
    ids: {
      organisationId: string;
      jobId: string;
      vehicleId: string;
      trackerId: string;
    },
    status: JobStatus,
  ) {
    const last = await this.latestPing(tx, { importJobId: ids.jobId });
    const points = this.gps.pointsTowardAnchor(
      status,
      last ? this.coordinates(last) : null,
    );
    if (points.length === 0) return;
    const after = await this.latestTime(tx, ids.trackerId, last);
    const start = after?.getTime() ?? Date.now();
    const atSea =
      status === 'SHIPPING_TO_CYPRUS' || status === 'ARRIVED_CYPRUS';
    const data = points.map((point, index) => ({
      organisationId: ids.organisationId,
      trackerId: ids.trackerId,
      vehicleId: ids.vehicleId,
      importJobId: ids.jobId,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: 10,
      speed: atSea ? 18 : 72,
      heading: Math.round(
        bearingDegrees(point, points[index + 1] ?? point) % 360,
      ),
      recordedAt: new Date(start + (index + 1) * PING_GAP_MS),
    }));
    await tx.locationEvent.createMany({ data, skipDuplicates: true });
    await tx.tracker.update({
      where: { id: ids.trackerId },
      data: {
        lastSeenAt: data[data.length - 1].recordedAt,
        status: 'ASSIGNED',
      },
    });
  }

  private latestPing(tx: Tx, where: Prisma.LocationEventWhereInput) {
    return tx.locationEvent.findFirst({
      where: { ...where, isDuplicate: false },
      orderBy: { recordedAt: 'desc' },
    });
  }

  /**
   * The later of the job's last ping and the tracker's, so that a new simulated
   * ping never repeats a time the tracker has used.
   */
  private async latestTime(
    tx: Tx,
    trackerId: string,
    jobPing: LocationEvent | null,
  ) {
    const own = await this.latestPing(tx, { trackerId });
    const times = [jobPing, own].flatMap((event) =>
      event ? [event.recordedAt.getTime()] : [],
    );
    return times.length ? new Date(Math.max(...times)) : null;
  }

  private coordinates(event: LocationEvent) {
    return {
      latitude: Number(event.latitude),
      longitude: Number(event.longitude),
    };
  }

  private toVehicleTracking(
    job: {
      id: string;
      reference: string;
      status: string;
      routeId?: string | null;
      customer: { firstName: string; lastName: string };
      vehicle: {
        make: string | null;
        model: string | null;
        ukRegistration: string | null;
      };
      routeTemplate?: {
        id: string;
        code: string;
        name: string;
        description: string | null;
        waypoints: unknown;
      } | null;
      trackerAssignments: Array<{
        id: string;
        assignedAt: Date;
        tracker: {
          id: string;
          serialNumber: string;
          provider: string;
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
    const current = trail[trail.length - 1] ?? null;
    const assignment = job.trackerAssignments[0] ?? null;
    const plannedRoute = plannedRouteForJob({
      status: job.status,
      current,
      waypoints: job.routeTemplate?.waypoints,
    });
    return {
      importJobId: job.id,
      reference: job.reference,
      status: job.status,
      routeId: job.routeId ?? null,
      customer: job.customer,
      vehicle: job.vehicle,
      current,
      trail,
      plannedRoute,
      routeTemplate: job.routeTemplate
        ? {
            id: job.routeTemplate.id,
            code: job.routeTemplate.code,
            name: job.routeTemplate.name,
            description: job.routeTemplate.description,
          }
        : null,
      tracker:
        includeTracker && assignment
          ? {
              assignmentId: assignment.id,
              assignedAt: assignment.assignedAt,
              id: assignment.tracker.id,
              serialNumber: assignment.tracker.serialNumber,
              provider: assignment.tracker.provider,
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
