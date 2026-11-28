import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { isTerminalStatus, TERMINAL_STATUSES } from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowRoutesService } from '../workflow/workflow-routes.service';
import type { AuthUser } from '../auth/auth.types';
import { AiTransport } from '../integrations/ai-transport';
import { AlertPolish } from './alert-polish';
import {
  enrichOpsAlertsHeuristic,
  type EnrichedOpsAlert,
} from './ops-alert-triage';
import { trackerAlerts } from './tracker-alerts';
import { trackerThresholds } from '../tracking/tracker-thresholds';
import {
  buildNearDestinationAlert,
  DEFAULT_NEAR_DESTINATION_METERS,
  haversineMeters,
  isNearDestination,
  parsePositiveNumber,
  routeDestination,
} from './ops-alerts';

/** How many overdue tasks and arrivals the Board lists. */
const BOARD_ROWS = 8;
/** How many GPS alerts of each kind it lists. The rest are counted. */
export const ALERTS_PER_KIND = 25;

const CLOSED = [...TERMINAL_STATUSES];

type StatusCount = {
  routeId: string | null;
  status: string;
  _count: { _all: number };
};

type BoardRoute = Awaited<ReturnType<WorkflowRoutesService['list']>>[number];

type TrackedPosition = {
  id: string;
  reference: string;
  status: string;
  routeTemplateId: string | null;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
};

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private readonly polish = new AlertPolish((error) =>
    this.logger.warn(`Could not polish GPS alerts: ${String(error)}`),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ai: AiTransport,
    private readonly workflows: WorkflowRoutesService,
  ) {}

  /**
   * The Board, for every route or, with `routeId`, for one. The database does
   * the counting, and every list it sends has a limit.
   */
  async get(user: AuthUser, routeId?: string) {
    const organisationId = user.organisationId;
    const routes = await this.workflows.list(user);
    // Checks the route belongs to this workspace before filtering by it.
    if (routeId && !routes.some((route) => route.id === routeId)) {
      throw new NotFoundException('Route not found');
    }
    const onRoute = routeId ? { routeId } : {};
    const now = new Date();

    const overdue: Prisma.TaskWhereInput = {
      organisationId,
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      dueDate: { lt: now },
      ...(routeId ? { importJob: { routeId } } : {}),
    };
    const arriving: Prisma.ImportJobWhereInput = {
      organisationId,
      status: { notIn: CLOSED },
      ...onRoute,
      expectedDeliveryDate: {
        gte: now,
        lte: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      },
    };

    const [
      counts,
      overdueTasks,
      overdueTaskCount,
      upcomingDeliveries,
      upcomingDeliveryCount,
      alerts,
    ] = await Promise.all([
      this.prisma.importJob.groupBy({
        by: ['routeId', 'status'],
        where: { organisationId, ...onRoute },
        _count: { _all: true },
      }),
      this.prisma.task.findMany({
        where: overdue,
        select: {
          id: true,
          title: true,
          dueDate: true,
          importJob: { select: { id: true, reference: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: BOARD_ROWS,
      }),
      this.prisma.task.count({ where: overdue }),
      this.prisma.importJob.findMany({
        where: arriving,
        select: {
          id: true,
          reference: true,
          status: true,
          routeId: true,
          expectedDeliveryDate: true,
          customer: { select: { firstName: true, lastName: true } },
          vehicle: {
            select: { make: true, model: true, ukRegistration: true },
          },
        },
        orderBy: [{ expectedDeliveryDate: 'asc' }, { id: 'asc' }],
        take: BOARD_ROWS,
      }),
      this.prisma.importJob.count({ where: arriving }),
      this.gpsAlerts(organisationId, now, routeId),
    ]);

    return {
      activeJobs: counts
        .filter((row) => !isTerminalStatus(row.status))
        .reduce((sum, row) => sum + row._count._all, 0),
      byRoute: this.byRoute(routes, counts, routeId),
      overdueTasks,
      overdueTaskCount,
      upcomingDeliveries,
      upcomingDeliveryCount,
      opsAlerts: this.enrichOpsAlerts(organisationId, alerts.shown),
      opsAlertCount: alerts.total,
    };
  }

  /**
   * Tracker alerts (quiet, low battery, low vehicle battery, not confirmed
   * removed, still reporting after its job), then vehicles close to arriving.
   */
  private async gpsAlerts(organisationId: string, now: Date, routeId?: string) {
    const [trackers, near] = await Promise.all([
      trackerAlerts(this.prisma, {
        organisationId,
        now,
        routeId,
        perKind: ALERTS_PER_KIND,
        ...trackerThresholds((key) => this.config.get<string>(key)),
      }),
      this.nearDestination(organisationId, routeId),
    ]);
    return {
      shown: [...trackers.shown, ...near.slice(0, ALERTS_PER_KIND)],
      total: trackers.total + near.length,
    };
  }

  /**
   * Distance is worked out here, so this reads one small row for each open job
   * with a tracker: its newest position, never its trail.
   */
  private async nearDestination(organisationId: string, routeId?: string) {
    const radiusMeters = parsePositiveNumber(
      this.config.get<string>('GPS_NEAR_DESTINATION_METERS'),
      DEFAULT_NEAR_DESTINATION_METERS,
    );
    const tracked = await this.prisma.$queryRaw<TrackedPosition[]>(Prisma.sql`
      SELECT job."id", job."reference", job."status", job."routeTemplateId",
             latest."latitude", latest."longitude"
      FROM "ImportJob" job
      CROSS JOIN LATERAL (
        SELECT event."latitude", event."longitude" FROM "LocationEvent" event
        WHERE event."importJobId" = job."id"
          AND event."organisationId" = ${organisationId}
          AND NOT event."isDuplicate"
        ORDER BY event."recordedAt" DESC
        LIMIT 1
      ) latest
      WHERE job."organisationId" = ${organisationId}
        AND job."status" NOT IN (${Prisma.join(CLOSED)})
        ${routeId ? Prisma.sql`AND job."routeId" = ${routeId}` : Prisma.empty}
        AND EXISTS (
          SELECT 1 FROM "TrackerAssignment" assignment
          WHERE assignment."importJobId" = job."id"
            AND assignment."removedAt" IS NULL
        )
      ORDER BY job."createdAt" DESC, job."id" DESC`);
    const templateIds = [
      ...new Set(
        tracked.flatMap((job) =>
          job.routeTemplateId ? [job.routeTemplateId] : [],
        ),
      ),
    ];
    const templates = templateIds.length
      ? await this.prisma.routeTemplate.findMany({
          where: { id: { in: templateIds } },
          select: { id: true, waypoints: true },
        })
      : [];
    const destinationOf = new Map(
      templates.map((template) => [
        template.id,
        routeDestination(template.waypoints),
      ]),
    );
    const fallback = routeDestination(undefined);

    return tracked.flatMap((job) => {
      const current = {
        latitude: Number(job.latitude),
        longitude: Number(job.longitude),
      };
      const destination =
        destinationOf.get(job.routeTemplateId ?? '') ?? fallback;
      if (
        !isNearDestination({
          status: job.status,
          current,
          destination,
          radiusMeters,
        })
      ) {
        return [];
      }
      return [
        buildNearDestinationAlert({
          importJobId: job.id,
          reference: job.reference,
          destinationLabel: destination.label,
          distanceMeters: haversineMeters(current, destination),
        }),
      ];
    });
  }

  /**
   * Open jobs in each stage of each route, plus completed ones. Draft routes
   * appear only once they have jobs.
   */
  private byRoute(
    routes: BoardRoute[],
    counts: StatusCount[],
    routeId?: string,
  ) {
    const fallback = routes.find((route) => route.isDefault)?.id ?? null;
    const total = (rows: StatusCount[]) =>
      rows.reduce((sum, row) => sum + row._count._all, 0);
    return routes
      .filter((route) =>
        routeId ? route.id === routeId : route.active || route.activeJobs > 0,
      )
      .map((route) => {
        const mine = counts.filter(
          (row) => (row.routeId ?? fallback) === route.id,
        );
        const open = mine.filter((row) => !isTerminalStatus(row.status));
        return {
          id: route.id,
          name: route.name,
          shortLabel: route.shortLabel,
          isDefault: route.isDefault,
          activeJobs: total(open),
          completed: total(mine.filter((row) => row.status === 'COMPLETED')),
          stages: route.stages.map((stage) => {
            const codes = new Set(stage.statuses.map((status) => status.code));
            return {
              id: stage.id,
              name: stage.name,
              count: total(open.filter((row) => codes.has(row.status))),
            };
          }),
        };
      });
  }

  /**
   * Heuristic triage always. OpenAI wording, when keyed, is fetched in the
   * background and shown from a later load. Staff-only.
   */
  private enrichOpsAlerts(
    organisationId: string,
    opsAlerts: Parameters<typeof enrichOpsAlertsHeuristic>[0],
  ): EnrichedOpsAlert[] {
    const enriched = enrichOpsAlertsHeuristic(opsAlerts);
    if (enriched.length === 0 || this.ai.provider() !== 'openai') {
      return enriched;
    }
    return this.polish.apply(organisationId, enriched, (wanted) =>
      this.askForPolish(wanted),
    );
  }

  private askForPolish(enriched: EnrichedOpsAlert[]) {
    return this.ai.completeJson<{
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
    });
  }
}
