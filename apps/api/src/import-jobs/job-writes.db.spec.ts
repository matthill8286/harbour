/**
 * Runs against a real PostgreSQL database, because transactions, locks and the
 * backfill's SQL cannot be checked with a mock. Skipped unless
 * TEST_DATABASE_URL names a scratch database that already has the schema:
 *
 *   DATABASE_URL=<scratch url> pnpm run db:deploy
 *   TEST_DATABASE_URL=<scratch url> pnpm exec jest job-writes
 */
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../tenancy/usage.service';
import { monthStartUtc } from '../tenancy/tenant-keys';
import { WorkflowRoutesService } from '../workflow/workflow-routes.service';
import { ImportJobsService } from './import-jobs.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;
const year = new Date().getFullYear();
const ref = (n: number, country = 'CY') =>
  `${country}-${year}-${String(n).padStart(5, '0')}`;

describeWithDatabase('job writes against PostgreSQL', () => {
  let prisma: PrismaService;
  let usage: UsageService;
  let workflows: WorkflowRoutesService;
  let service: ImportJobsService;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const audit = new AuditService(prisma);
    usage = new UsageService(prisma);
    workflows = new WorkflowRoutesService(prisma, audit);
    const none = {} as never;
    service = new ImportJobsService(
      prisma,
      audit,
      { notify: jest.fn() } as never,
      { alignToStatus: jest.fn() } as never,
      usage,
      { defaultTemplateId: () => Promise.resolve(null) } as never,
      workflows,
      none,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** A new workspace with an admin, a customer and its default route. */
  async function workspace() {
    const id = randomUUID();
    const organisation = await prisma.organisation.create({
      data: { name: id, slug: id },
    });
    const admin = await prisma.user.create({
      data: { email: `${id}@example.test`, name: 'Admin' },
    });
    const customer = await prisma.customer.create({
      data: {
        organisationId: organisation.id,
        firstName: 'Test',
        lastName: 'Customer',
      },
    });
    const route = await workflows.ensureDefault(organisation.id);
    const user = {
      id: admin.id,
      organisationId: organisation.id,
      organisationCountry: organisation.country,
      role: 'ADMIN',
    } as AuthUser;
    return { user, customer, route, organisationId: organisation.id };
  }
  type Workspace = Awaited<ReturnType<typeof workspace>>;

  const create = (w: Workspace) =>
    service.create(w.user, { customerId: w.customer.id, make: 'Test' });

  const createFor = (w: Workspace, destinationCountry: string) =>
    service.create(w.user, {
      customerId: w.customer.id,
      destinationCountry,
    });

  const counts = async ({ organisationId }: Workspace) => {
    const where = { organisationId };
    const [vehicles, jobs, history, usageRows] = await Promise.all([
      prisma.vehicle.count({ where }),
      prisma.importJob.count({ where }),
      prisma.jobStatusHistory.count({ where }),
      prisma.usageRecord.findMany({ where }),
    ]);
    const used = usageRows.reduce((sum, row) => sum + row.quantity, 0);
    return { vehicles, jobs, history, used };
  };

  it('gives jobs created at once their own references, per workspace', async () => {
    const [a, b] = [await workspace(), await workspace()];
    const jobs = await Promise.all([
      ...Array.from({ length: 12 }, () => create(a)),
      ...Array.from({ length: 3 }, () => create(b)),
    ]);
    const refs = (w: Workspace) =>
      jobs
        .filter((job) => job.organisationId === w.organisationId)
        .map((job) => job.reference)
        .sort();
    expect(refs(a)).toEqual(Array.from({ length: 12 }, (_, i) => ref(i + 1)));
    expect(refs(b)).toEqual([ref(1), ref(2), ref(3)]);
    expect(await counts(a)).toEqual({
      vehicles: 12,
      jobs: 12,
      history: 12,
      used: 12,
    });
    expect((await counts(b)).used).toBe(3);
  }, 30_000);

  it('numbers each destination country on its own, per workspace', async () => {
    const [a, b] = [await workspace(), await workspace()];
    const jobs = await Promise.all([
      ...Array.from({ length: 4 }, () => create(a)),
      ...Array.from({ length: 4 }, () => createFor(a, 'MT')),
      ...Array.from({ length: 2 }, () => createFor(b, 'mt')),
    ]);
    expect(jobs.map((job) => job.reference).sort()).toEqual(
      [
        ...[1, 2, 3, 4].map((n) => ref(n)),
        ...[1, 2, 3, 4].map((n) => ref(n, 'MT')),
        ...[1, 2].map((n) => ref(n, 'MT')),
      ].sort(),
    );
  }, 30_000);

  it('takes the prefix from the route, then from the workspace', async () => {
    const w = await workspace();
    const first = await create(w);
    await prisma.route.update({
      where: { id: w.route.id },
      data: { destinationCountry: 'IE' },
    });
    await expect(create(w)).resolves.toMatchObject({
      reference: ref(1, 'IE'),
      destinationCountry: 'IE',
    });
    // Not a country code, so the workspace's own country is used.
    const user = { ...w.user, organisationCountry: 'GR' };
    await expect(
      service.create(user, {
        customerId: w.customer.id,
        destinationCountry: 'Malta',
      }),
    ).resolves.toMatchObject({ reference: ref(1, 'GR') });
    // Changing a job's destination later does not rename it.
    await service.update(user, first.id, { destinationCountry: 'MT' });
    await expect(
      prisma.importJob.findUnique({ where: { id: first.id } }),
    ).resolves.toMatchObject({ reference: ref(1) });
  });

  it('carries on from the highest existing reference and leaves it unchanged', async () => {
    const w = await workspace();
    const first = await create(w);
    // A gap and a reference in another form, as a seeded or imported job might have.
    await prisma.importJob.update({
      where: { id: first.id },
      data: { reference: ref(421) },
    });
    const odd = await create(w);
    await prisma.importJob.update({
      where: { id: odd.id },
      data: { reference: `CY-${year}-OLD` },
    });
    await expect(create(w)).resolves.toMatchObject({ reference: ref(422) });
    await expect(
      prisma.importJob.findUnique({ where: { id: first.id } }),
    ).resolves.toMatchObject({ reference: ref(421) });
  });

  it('saves nothing when any part of creating a job fails', async () => {
    const w = await workspace();
    const spy = jest
      .spyOn(usage, 'incrementImportJobs')
      .mockRejectedValueOnce(new Error('usage failed'));
    await expect(create(w)).rejects.toThrow('usage failed');
    spy.mockRestore();
    expect(await counts(w)).toEqual({
      vehicles: 0,
      jobs: 0,
      history: 0,
      used: 0,
    });
    await expect(create(w)).resolves.toMatchObject({ reference: ref(1) });
  });

  it('saves no vehicle when the route is refused', async () => {
    const [w, other] = [await workspace(), await workspace()];
    await expect(
      service.create(w.user, {
        customerId: w.customer.id,
        routeId: other.route.id,
      }),
    ).rejects.toThrow('Route not found');
    expect((await counts(w)).vehicles).toBe(0);
  });

  it('lets only one of two status changes made at once succeed', async () => {
    const w = await workspace();
    const job = await create(w);
    const next = w.route.stages.flatMap((s) => s.statuses)[1].code;
    const results = await Promise.allSettled([
      service.changeStatus(w.user, job.id, { status: next }),
      service.changeStatus(w.user, job.id, { status: 'CANCELLED' }),
      service.changeStatus(w.user, job.id, { status: next }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const history = await prisma.jobStatusHistory.findMany({
      where: { importJobId: job.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history).toHaveLength(2);
    await expect(
      prisma.importJob.findUnique({ where: { id: job.id } }),
    ).resolves.toMatchObject({ status: history[1].toStatus });
  });

  it('removes a stage completely or not at all', async () => {
    const w = await workspace();
    const job = await create(w);
    const [first, second] = w.route.stages;
    const target = second.statuses[0].code;
    // Makes the last step fail inside the database, after the jobs have moved.
    // The trigger refuses only this stage. Other database specs run at the same
    // time against the same database, and they must still be able to remove
    // their own stages while it is in place.
    const name = `refuse_${randomUUID().replaceAll('-', '')}`;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE DELETE ON "RouteStage" FOR EACH ROW WHEN (OLD."id" = '${first.id}') EXECUTE FUNCTION ${name}()`,
    );
    try {
      await expect(
        workflows.removeStage(w.user, w.route.id, first.id, target),
      ).rejects.toThrow('refused');
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "RouteStage"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}`);
    }
    await expect(
      prisma.importJob.findUnique({ where: { id: job.id } }),
    ).resolves.toMatchObject({ status: job.status });
    expect((await counts(w)).history).toBe(1);

    const route = await workflows.removeStage(
      w.user,
      w.route.id,
      first.id,
      target,
    );
    expect(route.stages).toHaveLength(w.route.stages.length - 1);
    await expect(
      prisma.importJob.findUnique({ where: { id: job.id } }),
    ).resolves.toMatchObject({ status: target });
    expect((await counts(w)).history).toBe(2);
  });

  it('never leaves a job at a removed status when work arrives at the same time', async () => {
    for (let round = 0; round < 5; round += 1) {
      const w = await workspace();
      const job = await create(w);
      const [first, second] = w.route.stages;
      const next = w.route.stages.flatMap((s) => s.statuses)[1].code;
      const results = await Promise.allSettled([
        workflows.removeStage(
          w.user,
          w.route.id,
          first.id,
          second.statuses[0].code,
        ),
        service.changeStatus(w.user, job.id, { status: next }),
        create(w),
        create(w),
      ]);
      expect(results[0].status).toBe('fulfilled');
      const codes = (
        await prisma.routeStatus.findMany({ where: { routeId: w.route.id } })
      ).map((s) => s.code);
      const jobs = await prisma.importJob.findMany({
        where: { organisationId: w.organisationId },
      });
      for (const saved of jobs) expect(codes).toContain(saved.status);
    }
  }, 60_000);

  it('backfills usage by month, and again without changing anything', async () => {
    const [a, b] = [await workspace(), await workspace()];
    const made = [await create(a), await create(a), await create(a)];
    await create(b);
    // The last moment of one UTC month and the first of the next.
    const dates = [
      '2026-01-31T23:59:59.999Z',
      '2026-02-01T00:00:00.000Z',
      '2026-02-15T12:00:00.000Z',
    ];
    for (const [i, job] of made.entries()) {
      await prisma.importJob.update({
        where: { id: job.id },
        data: { createdAt: new Date(dates[i]) },
      });
    }
    // Only this test's workspaces: other database specs share these tables and run alongside.
    await prisma.usageRecord.deleteMany({
      where: {
        organisationId: { in: [a.organisationId, b.organisationId] },
      },
    });
    // A count already higher than the jobs that remain is kept.
    const bMonth = monthStartUtc(new Date());
    await usage.incrementImportJobs(b.organisationId, bMonth);
    await prisma.usageRecord.updateMany({
      where: { organisationId: b.organisationId },
      data: { quantity: 9 },
    });

    await usage.onApplicationBootstrap();
    const monthly = async () =>
      (
        await prisma.usageRecord.findMany({
          where: { organisationId: a.organisationId },
          orderBy: { periodStart: 'asc' },
        })
      ).map((r) => [r.periodStart.toISOString(), r.quantity]);
    expect(await monthly()).toEqual([
      ['2026-01-01T00:00:00.000Z', 1],
      ['2026-02-01T00:00:00.000Z', 2],
    ]);
    expect((await counts(b)).used).toBe(9);
    const before = await monthly();
    // The number of rows it changes covers every workspace, so compare this one's counts.
    await usage.backfillImportJobs();
    expect(await monthly()).toEqual(before);
    expect((await counts(b)).used).toBe(9);
    // Live metering adds to the row the backfill made.
    await usage.incrementImportJobs(a.organisationId, new Date(dates[2]));
    expect((await counts(a)).used).toBe(4);
  });

  it('keeps the count exact when a job is saved while the backfill runs', async () => {
    const w = await workspace();
    const made = [await create(w), await create(w), await create(w)];
    await prisma.usageRecord.deleteMany({
      where: { organisationId: w.organisationId },
    });
    let backfill: Promise<number> | undefined;
    // A fourth job, counted but not yet committed when the backfill starts.
    await prisma.$transaction(async (tx) => {
      await tx.importJob.create({
        data: {
          organisationId: w.organisationId,
          customerId: w.customer.id,
          vehicleId: made[0].vehicleId,
          reference: ref(900),
        },
      });
      await usage.incrementImportJobs(w.organisationId, new Date(), tx);
      backfill = usage.backfillImportJobs();
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    await backfill;
    expect((await counts(w)).used).toBe(4);
  });
});
