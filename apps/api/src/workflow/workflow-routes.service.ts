import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  newStatusCode,
  routeProblem,
  routeStatusCodes,
  TERMINAL_STATUSES,
  UK_CYPRUS_ROUTE_SEED,
  type RouteWorkflow,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import {
  CreateRouteDto,
  ReorderStagesDto,
  SaveStageDto,
  UpdateRouteDto,
} from './dto/route.dto';

const routeInclude = {
  stages: {
    orderBy: { sortOrder: 'asc' },
    include: { statuses: { orderBy: { sortOrder: 'asc' } } },
  },
} satisfies Prisma.RouteInclude;

export type RouteRow = Prisma.RouteGetPayload<{ include: typeof routeInclude }>;
type Tx = Prisma.TransactionClient;

const OPEN = { notIn: [...TERMINAL_STATUSES] };

export function toWorkflow(route: RouteRow): RouteWorkflow {
  return {
    id: route.id,
    name: route.name,
    shortLabel: route.shortLabel,
    originCountry: route.originCountry,
    destinationCountry: route.destinationCountry,
    isDefault: route.isDefault,
    active: route.active,
    systemKey: route.systemKey,
    stages: route.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      customerName: stage.customerName,
      customerVisible: stage.customerVisible,
      statuses: stage.statuses.map((status) => ({
        code: status.code,
        label: status.label,
      })),
    })),
  };
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * A workspace's routes, each with ordered stages and statuses. Jobs keep their
 * status as a code, so renaming a stage or status never touches a job.
 */
@Injectable()
export class WorkflowRoutesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkflowRoutesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Gives each workspace that lacks one its default route and puts older jobs
   * on it. Every workspace is tried. If any fails, each is logged and the start
   * fails, so unfinished data cannot go unnoticed behind a healthy API.
   */
  async onApplicationBootstrap() {
    const unfinished = await this.prisma.organisation.findMany({
      where: {
        OR: [
          { routes: { none: { isDefault: true } } },
          { importJobs: { some: { routeId: null } } },
        ],
      },
      select: { id: true },
    });
    let failed = 0;
    for (const org of unfinished) {
      try {
        await this.ensureDefault(org.id);
      } catch (error) {
        failed++;
        this.logger.error(
          `Could not set up the default route for workspace ${org.id}`,
          error as Error,
        );
      }
    }
    if (failed) {
      throw new Error(
        `Default route setup failed for ${failed} of ${unfinished.length} workspaces`,
      );
    }
  }

  /** The workspace's default route, created from the UK → Cyprus seed the first time. */
  async ensureDefault(organisationId: string): Promise<RouteWorkflow> {
    const route = await this.prisma.$transaction(async (tx) => {
      // One caller at a time per workspace, so two requests never seed twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organisationId}))`;
      let found = await tx.route.findFirst({
        where: { organisationId, isDefault: true },
        include: routeInclude,
      });
      if (!found) {
        const any = await tx.route.findFirst({
          where: { organisationId, active: true },
          orderBy: { sortOrder: 'asc' },
        });
        found = any
          ? await tx.route.update({
              where: { id: any.id },
              data: { isDefault: true },
              include: routeInclude,
            })
          : await this.seed(tx, organisationId);
      }
      await tx.importJob.updateMany({
        where: { organisationId, routeId: null },
        data: { routeId: found.id },
      });
      return found;
    });
    return toWorkflow(route);
  }

  /** The route a job follows: its own, or the default for a job not yet assigned one. */
  async workflowFor(organisationId: string, routeId: string | null) {
    if (!routeId) return this.ensureDefault(organisationId);
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organisationId },
      include: routeInclude,
    });
    if (!route) throw new NotFoundException('Route not found');
    return toWorkflow(route);
  }

  /** The route a new job should follow: the one asked for, if it is switched on, or the default. */
  async routeForNewJob(organisationId: string, routeId?: string) {
    if (!routeId) return this.ensureDefault(organisationId);
    const route = await this.workflowFor(organisationId, routeId);
    if (!route.active) {
      throw new BadRequestException(
        `${route.name} is a draft. Switch it on before creating jobs on it.`,
      );
    }
    return route;
  }

  /**
   * Call inside the transaction that puts a job at a status. It stops stages
   * being removed from the route until the transaction ends, and refuses a
   * status that was removed after it was checked.
   */
  async holdStatus(
    tx: Tx,
    organisationId: string,
    routeId: string,
    code: string,
  ) {
    await tx.$queryRaw`SELECT "id" FROM "Route" WHERE "id" = ${routeId} AND "organisationId" = ${organisationId} FOR SHARE`;
    if ((TERMINAL_STATUSES as readonly string[]).includes(code)) return;
    const status = await tx.routeStatus.findFirst({
      where: { routeId, code, route: { organisationId } },
      select: { id: true },
    });
    if (!status) {
      throw new ConflictException(
        'This route has just changed. Reload and try again.',
      );
    }
  }

  async list(user: AuthUser) {
    const readRoutes = () =>
      this.prisma.route.findMany({
        where: { organisationId: user.organisationId },
        include: routeInclude,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    let routes = await readRoutes();
    // The locking setup runs only for a workspace that has no default yet. Most
    // screens load this list, so it must not queue them behind one another.
    if (!routes.some((route) => route.isDefault)) {
      await this.ensureDefault(user.organisationId);
      routes = await readRoutes();
    }
    const counts = await this.prisma.importJob.groupBy({
      by: ['routeId', 'status'],
      where: { organisationId: user.organisationId, status: OPEN },
      _count: { _all: true },
    });
    return routes.map((route) => {
      const mine = counts.filter((c) => c.routeId === route.id);
      return {
        ...toWorkflow(route),
        activeJobs: mine.reduce((sum, c) => sum + c._count._all, 0),
        /** Open jobs at each status, so the editor knows what a removal would move. */
        jobsByStatus: Object.fromEntries(
          mine.map((c) => [c.status, c._count._all]),
        ),
      };
    });
  }

  async create(user: AuthUser, dto: CreateRouteDto) {
    const source = dto.copyFromId
      ? await this.find(user.organisationId, dto.copyFromId)
      : null;
    const last = await this.prisma.route.findFirst({
      where: { organisationId: user.organisationId },
      orderBy: { sortOrder: 'desc' },
    });
    const route = await this.prisma.$transaction(async (tx) => {
      const created = await tx.route.create({
        data: {
          organisationId: user.organisationId,
          name: dto.name.trim(),
          shortLabel: dto.shortLabel.trim(),
          originCountry: dto.originCountry.toUpperCase(),
          destinationCountry: dto.destinationCountry.toUpperCase(),
          sortOrder: (last?.sortOrder ?? 0) + 1,
        },
      });
      for (const [index, stage] of (source?.stages ?? []).entries()) {
        await this.createStage(tx, created.id, index, {
          name: stage.name,
          customerName: stage.customerName,
          customerVisible: stage.customerVisible,
          statuses: stage.statuses.map((s) => ({
            code: s.code,
            label: s.label,
          })),
        });
      }
      return created;
    });
    await this.audit.record(user, {
      action: 'ROUTE_CREATED',
      entityType: 'Route',
      entityId: route.id,
      metadata: { name: route.name, copiedFrom: source?.id ?? null },
    });
    return this.one(user.organisationId, route.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateRouteDto) {
    const route = await this.find(user.organisationId, id);
    const workflow = toWorkflow(route);
    const willBeActive = dto.active ?? route.active;
    if (dto.isDefault === false && route.isDefault) {
      throw new BadRequestException(
        'Make another route the default instead; a workspace always has one.',
      );
    }
    if (dto.active === false && route.isDefault) {
      throw new BadRequestException(
        'The default route cannot be switched off. Make another route the default first.',
      );
    }
    if (willBeActive && !route.active) {
      const problem = routeProblem(workflow);
      if (problem) throw new BadRequestException(problem);
    }
    if (dto.isDefault && !willBeActive) {
      throw new BadRequestException(
        'Switch the route on before making it the default.',
      );
    }
    await this.prisma.$transaction([
      ...(dto.isDefault
        ? [
            this.prisma.route.updateMany({
              where: { organisationId: user.organisationId, isDefault: true },
              data: { isDefault: false },
            }),
          ]
        : []),
      this.prisma.route.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          shortLabel: dto.shortLabel?.trim(),
          originCountry: dto.originCountry?.toUpperCase(),
          destinationCountry: dto.destinationCountry?.toUpperCase(),
          active: dto.active,
          isDefault: dto.isDefault || undefined,
        },
      }),
    ]);
    await this.audit.record(user, {
      action: 'ROUTE_UPDATED',
      entityType: 'Route',
      entityId: id,
      metadata: { ...dto },
    });
    return this.one(user.organisationId, id);
  }

  async addStage(user: AuthUser, routeId: string, dto: SaveStageDto) {
    const route = await this.find(user.organisationId, routeId);
    const taken = routeStatusCodes(toWorkflow(route));
    await this.prisma.$transaction((tx) =>
      this.createStage(tx, routeId, route.stages.length, {
        ...dto,
        statuses: dto.statuses.map(({ label }) => ({
          code: this.claim(label, taken),
          label,
        })),
      }),
    );
    await this.audit.record(user, {
      action: 'ROUTE_STAGE_ADDED',
      entityType: 'Route',
      entityId: routeId,
      metadata: { stage: dto.name },
    });
    return this.one(user.organisationId, routeId);
  }

  /**
   * Renames, reorders, adds and removes a stage's statuses. A status that jobs
   * are at cannot be removed here; removing the whole stage asks where they go.
   * The check and the changes are one transaction.
   */
  async saveStage(
    user: AuthUser,
    routeId: string,
    stageId: string,
    dto: SaveStageDto,
  ) {
    await this.prisma.$transaction(
      async (tx) => {
        // Locked as in removeStage, so no job reaches a status after the check below.
        await this.lockRoute(tx, user.organisationId, routeId);
        const route = await this.find(user.organisationId, routeId, tx);
        const stage = route.stages.find((item) => item.id === stageId);
        if (!stage) throw new NotFoundException('Stage not found');

        const mine = new Set(stage.statuses.map((s) => s.code));
        const stray = dto.statuses.find((s) => s.code && !mine.has(s.code));
        if (stray) {
          throw new BadRequestException(
            `${stray.label} belongs to another stage. Remove it there and add it here instead.`,
          );
        }
        const kept = new Set(
          dto.statuses.flatMap((s) => (s.code ? [s.code] : [])),
        );
        const removed = stage.statuses.filter((s) => !kept.has(s.code));
        if (removed.length) {
          const inUse = await tx.importJob.findMany({
            where: {
              organisationId: user.organisationId,
              routeId,
              status: { in: removed.map((s) => s.code) },
            },
            select: { status: true },
          });
          if (inUse.length) {
            const label = removed.find(
              (s) => s.code === inUse[0].status,
            )?.label;
            throw new ConflictException(
              `${plural(inUse.length, 'job is', 'jobs are')} at ${label}. Move them on first, or remove the whole stage and choose where they go.`,
            );
          }
        }

        const taken = routeStatusCodes(toWorkflow(route));
        await tx.routeStage.update({
          where: { id: stageId },
          data: {
            name: dto.name.trim(),
            customerName: (dto.customerName ?? dto.name).trim(),
            customerVisible: dto.customerVisible,
          },
        });
        if (removed.length) {
          await tx.routeStatus.deleteMany({
            where: { stageId, code: { in: removed.map((s) => s.code) } },
          });
        }
        for (const [index, status] of dto.statuses.entries()) {
          if (status.code) {
            await tx.routeStatus.update({
              where: { routeId_code: { routeId, code: status.code } },
              data: { label: status.label.trim(), sortOrder: index },
            });
          } else {
            await tx.routeStatus.create({
              data: {
                routeId,
                stageId,
                code: this.claim(status.label, taken),
                label: status.label.trim(),
                sortOrder: index,
              },
            });
          }
        }
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    await this.audit.record(user, {
      action: 'ROUTE_STAGE_UPDATED',
      entityType: 'Route',
      entityId: routeId,
      metadata: { stage: dto.name },
    });
    return this.one(user.organisationId, routeId);
  }

  async reorderStages(user: AuthUser, routeId: string, dto: ReorderStagesDto) {
    const route = await this.find(user.organisationId, routeId);
    const current = route.stages.map((s) => s.id).sort();
    const given = [...dto.stageIds].sort();
    if (
      current.length !== given.length ||
      current.some((id, i) => id !== given[i])
    ) {
      throw new BadRequestException(
        'Send every stage of the route, once each.',
      );
    }
    await this.prisma.$transaction(
      dto.stageIds.map((id, index) =>
        this.prisma.routeStage.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    await this.audit.record(user, {
      action: 'ROUTE_STAGES_REORDERED',
      entityType: 'Route',
      entityId: routeId,
    });
    return this.one(user.organisationId, routeId);
  }

  /**
   * Removes a stage. Jobs at its statuses move to `moveTo`, with a line in their
   * history. It all happens in one transaction, with the route locked so no job
   * can be created on it or moved along it part way through.
   */
  async removeStage(
    user: AuthUser,
    routeId: string,
    stageId: string,
    moveTo?: string,
  ) {
    const removed = await this.prisma.$transaction(
      async (tx) => {
        await this.lockRoute(tx, user.organisationId, routeId);
        const route = await this.find(user.organisationId, routeId, tx);
        const stage = route.stages.find((item) => item.id === stageId);
        if (!stage) throw new NotFoundException('Stage not found');
        if (route.active && route.stages.length === 1) {
          throw new BadRequestException(
            'A route that is switched on needs at least one stage.',
          );
        }
        const codes = stage.statuses.map((s) => s.code);
        const jobs = await tx.importJob.findMany({
          where: {
            organisationId: user.organisationId,
            routeId,
            status: { in: codes },
          },
          select: { id: true, status: true },
        });
        if (jobs.length) {
          const target = route.stages
            .filter((s) => s.id !== stageId)
            .flatMap((s) => s.statuses)
            .find((s) => s.code === moveTo);
          if (!target) {
            throw new BadRequestException(
              `${plural(jobs.length, 'job is', 'jobs are')} in ${stage.name}. Choose a status in another stage for them.`,
            );
          }
          const note = `Moved to ${target.label} because the ${stage.name} stage was removed`;
          // Each entry lands after the job's latest one, as status moves do, so history stays in order.
          const latest = await tx.jobStatusHistory.groupBy({
            by: ['importJobId'],
            where: { importJobId: { in: jobs.map((j) => j.id) } },
            _max: { createdAt: true },
          });
          const after = new Map(
            latest.map((row) => [
              row.importJobId,
              row._max.createdAt?.getTime() ?? 0,
            ]),
          );
          const now = Date.now();
          await tx.importJob.updateMany({
            where: { id: { in: jobs.map((j) => j.id) } },
            data: { status: target.code },
          });
          await tx.jobStatusHistory.createMany({
            data: jobs.map((job) => ({
              organisationId: user.organisationId,
              importJobId: job.id,
              fromStatus: job.status,
              toStatus: target.code,
              changedById: user.id,
              note,
              createdAt: new Date(
                Math.max(now, (after.get(job.id) ?? 0) + 60_000),
              ),
            })),
          });
        }
        await tx.routeStage.delete({ where: { id: stageId } });
        for (const [index, other] of route.stages
          .filter((s) => s.id !== stageId)
          .entries()) {
          await tx.routeStage.update({
            where: { id: other.id },
            data: { sortOrder: index },
          });
        }
        return { stage: stage.name, jobsMoved: jobs.length };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    await this.audit.record(user, {
      action: 'ROUTE_STAGE_REMOVED',
      entityType: 'Route',
      entityId: routeId,
      metadata: { ...removed, moveTo },
    });
    return this.one(user.organisationId, routeId);
  }

  /** Waits for jobs being created or moved on the route, and holds off new ones. */
  private lockRoute(tx: Tx, organisationId: string, routeId: string) {
    return tx.$queryRaw`SELECT "id" FROM "Route" WHERE "id" = ${routeId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  }

  private async one(organisationId: string, id: string) {
    return toWorkflow(await this.find(organisationId, id));
  }

  private async find(organisationId: string, id: string, db: Tx = this.prisma) {
    const route = await db.route.findFirst({
      where: { id, organisationId },
      include: routeInclude,
    });
    if (!route) throw new NotFoundException('Route not found');
    return route;
  }

  /** Picks a code for a new status and marks it taken, so two new ones in a save never clash. */
  private claim(label: string, taken: string[]) {
    const code = newStatusCode(label, taken);
    taken.push(code);
    return code;
  }

  private async seed(tx: Tx, organisationId: string) {
    const seed = UK_CYPRUS_ROUTE_SEED;
    const route = await tx.route.create({
      data: {
        organisationId,
        name: seed.name,
        shortLabel: seed.shortLabel,
        originCountry: seed.originCountry,
        destinationCountry: seed.destinationCountry,
        systemKey: seed.systemKey,
        isDefault: true,
        active: true,
      },
    });
    for (const [index, stage] of seed.stages.entries()) {
      await this.createStage(tx, route.id, index, {
        ...stage,
        statuses: [...stage.statuses],
      });
    }
    return tx.route.findUniqueOrThrow({
      where: { id: route.id },
      include: routeInclude,
    });
  }

  private async createStage(
    tx: Tx,
    routeId: string,
    sortOrder: number,
    stage: {
      name: string;
      customerName?: string;
      customerVisible: boolean;
      statuses: Array<{ code: string; label: string }>;
    },
  ) {
    await tx.routeStage.create({
      data: {
        routeId,
        name: stage.name.trim(),
        customerName: (stage.customerName ?? stage.name).trim(),
        customerVisible: stage.customerVisible,
        sortOrder,
        statuses: {
          create: stage.statuses.map((status, index) => ({
            routeId,
            code: status.code,
            label: status.label.trim(),
            sortOrder: index,
          })),
        },
      },
    });
  }
}
