/**
 * The paged lists, the Board and the live map against a real PostgreSQL
 * database, with two workspaces. Cursor order, relation filters and the raw
 * latest-position queries cannot be checked with a mock. Skipped unless
 * TEST_DATABASE_URL names a scratch database that already has the schema.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CustomersService } from '../customers/customers.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { ImportJobsService } from '../import-jobs/import-jobs.service';
import type { JobListQuery } from '../import-jobs/dto/job-list.query';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { WorkflowRoutesService } from '../workflow/workflow-routes.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;

const LIMASSOL = { label: 'Limassol', latitude: 34.7071, longitude: 33.0226 };
const SOFIA = { label: 'Sofia', latitude: 42.6977, longitude: 23.3219 };
const LONDON = { label: 'London', latitude: 51.5074, longitude: -0.1278 };

describeWithDatabase('lists against PostgreSQL', () => {
  let prisma: PrismaService;
  let workflows: WorkflowRoutesService;
  let jobs: ImportJobsService;
  let customers: CustomersService;
  let vehicles: VehiclesService;
  let dashboard: DashboardService;
  let tracking: TrackingService;
  let a: Workspace;
  let b: Workspace;

  type Workspace = Awaited<ReturnType<typeof workspace>>;

  /**
   * Seven jobs, customers and vehicles. Several share a creation time, and
   * several customers share a name, so only the id can order them. Workspace
   * words are the same in both, so a leak would show up as extra rows.
   */
  async function workspace() {
    const key = randomUUID();
    const organisationId = key;
    await prisma.organisation.create({
      data: { id: organisationId, name: key, slug: key },
    });
    const route = await workflows.ensureDefault(organisationId);
    const [first, second] = route.stages;
    const template = await prisma.routeTemplate.create({
      data: {
        organisationId,
        code: key,
        name: 'Corridor',
        waypoints: [LONDON, SOFIA, LIMASSOL],
      },
    });
    const statuses = [
      first.statuses[0].code,
      first.statuses[0].code,
      second.statuses[0].code,
      second.statuses[0].code,
      first.statuses[0].code,
      'COMPLETED',
      'CANCELLED',
    ];
    const day = 86_400_000;
    for (const [i, status] of statuses.entries()) {
      const id = `${key}-${i}`;
      await prisma.customer.create({
        data: {
          id,
          organisationId,
          firstName: i < 3 ? 'Anna' : 'Ben',
          lastName: i < 5 ? 'Brown' : 'Costa',
          email: `${i}-${key}@example.test`,
        },
      });
      await prisma.vehicle.create({
        data: {
          id,
          organisationId,
          make: i % 2 ? 'Ford' : 'Mazda',
          ukRegistration: `REG${i}`,
          createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 2))),
        },
      });
      await prisma.importJob.create({
        data: {
          id,
          organisationId,
          customerId: id,
          vehicleId: id,
          reference: `CY-TEST-${i}`,
          status,
          // The last job predates routes, so it belongs to the default one.
          routeId: i === 4 ? null : route.id,
          routeTemplateId: template.id,
          createdAt: new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 3))),
          expectedDeliveryDate: new Date(Date.now() + day),
        },
      });
      await prisma.task.create({
        data: {
          organisationId,
          importJobId: id,
          title: `Task ${i}`,
          dueDate: new Date(Date.now() - day * (i + 1)),
        },
      });
    }
    // Job 0 is quiet and near Sofia; job 1 is reporting from near Limassol.
    for (const [i, quiet, where] of [
      [0, true, SOFIA],
      [1, false, LIMASSOL],
    ] as const) {
      const tracker = await prisma.tracker.create({
        data: {
          organisationId,
          serialNumber: `SN-${i}-${key}`,
          provider: 'generic',
          status: 'ASSIGNED',
          lastSeenAt: new Date(Date.now() - (quiet ? 3 * day : 60_000)),
        },
      });
      await prisma.trackerAssignment.create({
        data: {
          organisationId,
          trackerId: tracker.id,
          vehicleId: `${key}-${i}`,
          importJobId: `${key}-${i}`,
        },
      });
      await prisma.locationEvent.createMany({
        data: Array.from({ length: 100 }, (_, n) => ({
          organisationId,
          trackerId: tracker.id,
          importJobId: `${key}-${i}`,
          latitude: n === 99 ? where.latitude : LONDON.latitude,
          longitude: n === 99 ? where.longitude : LONDON.longitude,
          recordedAt: new Date(Date.UTC(2026, 0, 1, 0, n)),
        })),
      });
      // A newer second copy of a ping is never a position.
      await prisma.locationEvent.create({
        data: {
          organisationId,
          trackerId: tracker.id,
          importJobId: `${key}-${i}`,
          latitude: 0,
          longitude: 0,
          recordedAt: new Date(Date.UTC(2026, 0, 2)),
          isDuplicate: true,
        },
      });
    }
    const user = { id: 'admin', organisationId, role: 'ADMIN' } as AuthUser;
    return { key, organisationId, user, route, first, second };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    workflows = new WorkflowRoutesService(prisma, new AuditService(prisma));
    const none = {} as never;
    const config = { get: () => undefined } as never;
    jobs = new ImportJobsService(
      prisma,
      none,
      none,
      none,
      none,
      none,
      workflows,
      none,
    );
    customers = new CustomersService(prisma, config, none, none, none);
    vehicles = new VehiclesService(prisma, none, none, config);
    dashboard = new DashboardService(
      prisma,
      config,
      { provider: () => 'log' } as never,
      workflows,
    );
    tracking = new TrackingService(prisma, none, {
      getConfig: () => ({}),
    } as never);
    a = await workspace();
    b = await workspace();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  type Listed = { items: Array<{ id: string }>; nextCursor: string | null };

  /** Every id, following the cursor two rows at a time. */
  async function walk(list: (cursor?: string) => Promise<Listed>) {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list(cursor);
      expect(page.items.length).toBeLessThanOrEqual(2);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return ids;
  }
  const ids = (w: Workspace, ...numbers: number[]) =>
    numbers.map((n) => `${w.key}-${n}`);

  const jobIds = async (w: Workspace, query: JobListQuery = {}) => {
    const page = await jobs.list(w.user, query);
    expect(page.total).toBe(page.items.length);
    return page.items.map((job) => job.id).sort();
  };

  it('pages jobs, customers and vehicles in a stable order, one workspace at a time', async () => {
    for (const w of [a, b]) {
      await expect(
        walk((cursor) => jobs.list(w.user, { cursor, limit: 2 })),
      ).resolves.toEqual(ids(w, 6, 5, 4, 3, 2, 1, 0));
      await expect(
        walk((cursor) => customers.list(w.user, { cursor, limit: 2 })),
      ).resolves.toEqual(ids(w, 0, 1, 2, 3, 4, 5, 6));
      await expect(
        walk((cursor) => vehicles.list(w.user, { cursor, limit: 2 })),
      ).resolves.toEqual(ids(w, 5, 3, 1, 6, 4, 2, 0));
      await expect(customers.list(w.user, { limit: 2 })).resolves.toMatchObject(
        { total: 7 },
      );
      await expect(vehicles.list(w.user, { limit: 2 })).resolves.toMatchObject({
        total: 7,
      });
    }
  });

  it("never lets another workspace's cursor, route or stage reach its rows", async () => {
    const theirs = await jobs.list(b.user, { limit: 2 });
    const page = await jobs.list(a.user, { cursor: theirs.nextCursor! });
    expect(page.items.every((job) => job.organisationId === a.key)).toBe(true);
    await expect(jobIds(a, { route: b.route.id })).resolves.toEqual([]);
    await expect(jobIds(a, { stage: b.first.id })).resolves.toEqual([]);
  });

  it('does not repeat or skip rows when one is added or removed between pages', async () => {
    const w = await workspace();
    const start = await jobs.list(w.user, { limit: 2 });
    await prisma.importJob.delete({ where: { id: `${w.key}-6` } });
    await prisma.importJob.create({
      data: {
        organisationId: w.key,
        customerId: `${w.key}-0`,
        vehicleId: `${w.key}-0`,
        reference: 'CY-NEW',
      },
    });
    const next = await jobs.list(w.user, {
      limit: 2,
      cursor: start.nextCursor!,
    });
    expect(next.items.map((job) => job.id)).toEqual(ids(w, 4, 3));
  });

  it('filters jobs by route, stage, status and search on the server', async () => {
    await expect(jobIds(a, { route: a.route.id })).resolves.toHaveLength(7);
    await expect(jobIds(a, { stage: a.first.id })).resolves.toEqual(
      ids(a, 0, 1, 4),
    );
    await expect(
      jobIds(a, { stage: a.second.id, route: a.route.id }),
    ).resolves.toEqual(ids(a, 2, 3));
    await expect(jobIds(a, { stage: 'completed' })).resolves.toEqual(ids(a, 5));
    await expect(
      jobIds(a, { stage: a.first.id, status: 'CANCELLED' }),
    ).resolves.toEqual(ids(a, 6));
    await expect(jobIds(a, { search: 'ford' })).resolves.toEqual(
      ids(a, 1, 3, 5),
    );
    await expect(jobIds(a, { search: 'reg2' })).resolves.toEqual(ids(a, 2));
  });

  it('counts jobs by route and status whatever route and stage are chosen', async () => {
    const page = await jobs.list(a.user, {
      search: 'ford',
      stage: a.second.id,
      limit: 1,
    });
    expect(page.total).toBe(1);
    expect(page.counts.reduce((sum, row) => sum + row.count, 0)).toBe(3);
    expect(page.counts).toContainEqual({
      routeId: a.route.id,
      status: 'COMPLETED',
      count: 1,
    });
  });

  it('searches customers by full name, and vehicles, within the workspace', async () => {
    const found = await customers.list(a.user, { search: 'anna  brown' });
    expect(found.items.map((c) => c.id)).toEqual(ids(a, 0, 1, 2));
    expect(found.total).toBe(3);
    const mazdas = await vehicles.list(a.user, { search: 'mazda' });
    expect(mazdas.items.map((v) => v.id).sort()).toEqual(ids(a, 0, 2, 4, 6));
  });

  it('fills the Board from counts and short lists, without the route setup lock', async () => {
    const setup = jest.spyOn(workflows, 'ensureDefault');
    const board = await dashboard.get(a.user);
    await workflows.list(a.user);
    expect(setup).not.toHaveBeenCalled();
    setup.mockRestore();

    expect(board.activeJobs).toBe(5);
    expect(board.byRoute).toHaveLength(1);
    expect(board.byRoute[0]).toMatchObject({ activeJobs: 5, completed: 1 });
    expect(board.byRoute[0].stages.slice(0, 2).map((s) => s.count)).toEqual([
      3, 2,
    ]);
    expect(board.overdueTaskCount).toBe(7);
    expect(board.overdueTasks[0].title).toBe('Task 6');
    expect(board.upcomingDeliveryCount).toBe(5);
    expect(board.opsAlerts.map((x) => [x.kind, x.importJobId])).toEqual([
      ['STALE_TRACKER', `${a.key}-0`],
      ['NEAR_DESTINATION', `${a.key}-1`],
    ]);
    expect(board.opsAlertCount).toBe(2);
    await expect(dashboard.get(a.user, b.route.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(dashboard.get(a.user, a.route.id)).resolves.toMatchObject({
      opsAlertCount: 2,
    });
  });

  it('still sets up a default route for a workspace that has none', async () => {
    const id = randomUUID();
    await prisma.organisation.create({ data: { id, name: id, slug: id } });
    const user = { organisationId: id } as AuthUser;
    await expect(workflows.list(user)).resolves.toHaveLength(1);
  });

  it('sends only the newest position for each live vehicle, and one trail on request', async () => {
    const live = await tracking.live(a.user);
    expect(live.vehicles.map((v) => v.importJobId).sort()).toEqual(
      ids(a, 0, 1, 2, 3, 4),
    );
    const first = live.vehicles.find((v) => v.importJobId === `${a.key}-0`)!;
    expect(first).not.toHaveProperty('trail');
    expect(first.current).toMatchObject({
      latitude: SOFIA.latitude,
      longitude: SOFIA.longitude,
    });
    // Sofia onwards of London, Sofia, Limassol.
    expect(first.corridor?.from).toBe(1);
    expect(live.corridors[first.corridor!.id]).toHaveLength(3);
    const none = live.vehicles.find((v) => v.importJobId === `${a.key}-2`)!;
    expect(none.current).toBeNull();

    const { trail } = await tracking.liveTrail(a.user, `${a.key}-0`);
    expect(trail).toHaveLength(80);
    expect(trail.at(-1)).toEqual(first.current);
    expect(trail[0].recordedAt < trail[1].recordedAt).toBe(true);
    await expect(tracking.liveTrail(b.user, `${a.key}-0`)).rejects.toThrow(
      NotFoundException,
    );
  });
});
