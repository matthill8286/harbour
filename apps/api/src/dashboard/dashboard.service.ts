import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getJobStage,
  JOB_STAGE_LABELS,
  type JobStage,
  type JobStatus,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { AiTransport } from '../integrations/ai-transport';
import {
  applyTriagePolish,
  enrichOpsAlertsHeuristic,
  type EnrichedOpsAlert,
} from './ops-alert-triage';
import {
  buildNearDestinationAlert,
  buildStaleTrackerAlert,
  DEFAULT_NEAR_DESTINATION_METERS,
  DEFAULT_STALE_TRACKER_MS,
  haversineMeters,
  isNearDestination,
  isTrackerStale,
  parsePositiveNumber,
  routeDestination,
  type OpsAlert,
} from './ops-alerts';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ai: AiTransport,
  ) {}

  async get(user: AuthUser) {
    const staleThresholdMs = parsePositiveNumber(
      this.config.get<string>('GPS_STALE_TRACKER_MS'),
      DEFAULT_STALE_TRACKER_MS,
    );
    const nearRadiusMeters = parsePositiveNumber(
      this.config.get<string>('GPS_NEAR_DESTINATION_METERS'),
      DEFAULT_NEAR_DESTINATION_METERS,
    );
    const now = new Date();

    const [jobs, overdueTasks, upcomingDeliveries, trackedJobs] =
      await Promise.all([
        this.prisma.importJob.findMany({
          where: { organisationId: user.organisationId },
          select: {
            id: true,
            reference: true,
            status: true,
            expectedDeliveryDate: true,
            customer: { select: { firstName: true, lastName: true } },
            vehicle: {
              select: { make: true, model: true, ukRegistration: true },
            },
          },
        }),
        this.prisma.task.findMany({
          where: {
            organisationId: user.organisationId,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            dueDate: { lt: new Date() },
          },
          include: {
            importJob: { select: { id: true, reference: true } },
          },
          orderBy: { dueDate: 'asc' },
          take: 8,
        }),
        this.prisma.importJob.findMany({
          where: {
            organisationId: user.organisationId,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            expectedDeliveryDate: {
              gte: new Date(),
              lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            },
          },
          include: {
            customer: true,
            vehicle: true,
          },
          orderBy: { expectedDeliveryDate: 'asc' },
          take: 8,
        }),
        this.prisma.importJob.findMany({
          where: {
            organisationId: user.organisationId,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            trackerAssignments: { some: { removedAt: null } },
          },
          select: {
            id: true,
            reference: true,
            status: true,
            routeTemplate: { select: { waypoints: true } },
            trackerAssignments: {
              where: { removedAt: null },
              take: 1,
              select: {
                tracker: {
                  select: {
                    id: true,
                    serialNumber: true,
                    status: true,
                    lastSeenAt: true,
                  },
                },
              },
            },
            locationEvents: {
              orderBy: { recordedAt: 'desc' },
              take: 1,
              select: {
                latitude: true,
                longitude: true,
                recordedAt: true,
              },
            },
          },
        }),
      ]);

    const opsAlerts: OpsAlert[] = [];
    const offlineTrackers: {
      id: string;
      serialNumber: string;
      assignments: { importJob: { id: string; reference: string } }[];
    }[] = [];

    for (const job of trackedJobs) {
      const assignment = job.trackerAssignments[0];
      if (!assignment) continue;
      const tracker = assignment.tracker;

      const stale =
        tracker.status === 'OFFLINE' ||
        isTrackerStale({
          lastSeenAt: tracker.lastSeenAt,
          now,
          thresholdMs: staleThresholdMs,
        });

      if (stale) {
        offlineTrackers.push({
          id: tracker.id,
          serialNumber: tracker.serialNumber,
          assignments: [
            { importJob: { id: job.id, reference: job.reference } },
          ],
        });
        opsAlerts.push(
          buildStaleTrackerAlert({
            importJobId: job.id,
            reference: job.reference,
            trackerSerial: tracker.serialNumber,
            lastSeenAt: tracker.lastSeenAt,
          }),
        );
      }

      const lastPing = job.locationEvents[0];
      const current = lastPing
        ? {
            latitude: Number(lastPing.latitude),
            longitude: Number(lastPing.longitude),
          }
        : null;
      const destination = routeDestination(job.routeTemplate?.waypoints);
      if (
        isNearDestination({
          status: job.status,
          current,
          destination,
          radiusMeters: nearRadiusMeters,
        }) &&
        current
      ) {
        opsAlerts.push(
          buildNearDestinationAlert({
            importJobId: job.id,
            reference: job.reference,
            destinationLabel: destination.label,
            distanceMeters: haversineMeters(current, destination),
          }),
        );
      }
    }

    const byStage = jobs.reduce(
      (acc, job) => {
        const stage = getJobStage(job.status as JobStatus);
        acc[stage] = (acc[stage] ?? 0) + 1;
        return acc;
      },
      {} as Record<JobStage, number>,
    );

    const enrichedAlerts = await this.enrichOpsAlerts(opsAlerts);

    return {
      activeJobs: jobs.filter(
        (job) => !['COMPLETED', 'CANCELLED'].includes(job.status),
      ).length,
      byStage: Object.entries(JOB_STAGE_LABELS).map(([stage, label]) => ({
        stage,
        label,
        count: byStage[stage as JobStage] ?? 0,
      })),
      overdueTasks,
      upcomingDeliveries,
      offlineTrackers,
      opsAlerts: enrichedAlerts,
    };
  }

  /** Heuristic triage always; optional OpenAI polish when keyed. Staff-only. */
  private async enrichOpsAlerts(
    opsAlerts: OpsAlert[],
  ): Promise<EnrichedOpsAlert[]> {
    const enriched = enrichOpsAlertsHeuristic(opsAlerts);
    if (enriched.length === 0) {
      return enriched;
    }

    const polish = await this.ai.completeJson<{
      summaries?: Array<{
        kind?: string;
        importJobId?: string;
        aiSummary?: string;
      }>;
    }>({
      system:
        'You are Harbour ops assist writing short staff-only Board triage notes. Never draft customer emails. Each note: why it matters + one next step pointing staff to Tracking.',
      user: JSON.stringify({
        alerts: enriched.map((a) => ({
          kind: a.kind,
          importJobId: a.importJobId,
          reference: a.reference,
          title: a.title,
          detail: a.detail,
          trackerSerial: a.trackerSerial,
          heuristicSummary: a.aiSummary,
        })),
      }),
      schemaHint:
        '{ "summaries": Array<{ "kind": string, "importJobId": string, "aiSummary": string }> }',
      logFallback: {
        summaries: enriched.map((a) => ({
          kind: a.kind,
          importJobId: a.importJobId,
          aiSummary: a.aiSummary,
        })),
      },
    });

    return applyTriagePolish(enriched, polish);
  }
}
