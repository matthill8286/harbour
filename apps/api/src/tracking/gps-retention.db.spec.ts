/**
 * GPS retention against a real PostgreSQL database. Skipped unless
 * TEST_DATABASE_URL names a scratch database that already has the schema:
 *
 *   DATABASE_URL=<scratch url> pnpm run db:deploy
 *   TEST_DATABASE_URL=<scratch url> pnpm exec jest gps-retention.db
 *
 * The clock is set in 2001, so it only deletes the old rows made here.
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GpsRetentionService } from './gps-retention.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2001-06-01T12:00:00.000Z');
/** A time this many days before NOW, plus some milliseconds. */
const ago = (days: number, ms = 0) => new Date(NOW.getTime() - days * DAY + ms);

describeWithDatabase('GPS retention against PostgreSQL', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const retention = (days?: string) =>
    new GpsRetentionService(prisma, { get: () => days } as never);

  async function workspace() {
    const id = randomUUID();
    await prisma.organisation.create({ data: { id, name: id, slug: id } });
    const customer = await prisma.customer.create({
      data: { organisationId: id, firstName: 'Test', lastName: 'Customer' },
    });
    const tracker = await prisma.tracker.create({
      data: {
        organisationId: id,
        serialNumber: id,
        provider: 'generic',
        lastSeenAt: ago(200),
      },
    });
    let reference = 0;
    const job = async (status: string, completedAt: Date | null) => {
      const vehicle = await prisma.vehicle.create({
        data: { organisationId: id },
      });
      reference += 1;
      return prisma.importJob.create({
        data: {
          organisationId: id,
          customerId: customer.id,
          vehicleId: vehicle.id,
          reference: `R-${reference}`,
          status,
          completedAt,
          statusHistory: {
            create: { organisationId: id, toStatus: status },
          },
        },
      });
    };
    let linked = 0;
    const points = async (
      importJobId: string | null,
      recordedAt: Date,
      count = 1,
    ) => {
      const ids = Array.from({ length: count }, () => randomUUID());
      await prisma.locationEvent.createMany({
        data: ids.map((pointId) => ({
          id: pointId,
          organisationId: id,
          // One point keeps its tracker. The unique index allows one a time.
          trackerId: linked++ === 0 ? tracker.id : null,
          importJobId,
          latitude: 35,
          longitude: 33,
          recordedAt,
        })),
      });
      return ids;
    };
    return { id, tracker, job, points };
  }

  const remaining = async (organisationId: string) =>
    (
      await prisma.locationEvent.findMany({
        where: { organisationId },
        select: { id: true },
      })
    )
      .map((row) => row.id)
      .sort();

  const records = async (organisationId: string) => ({
    jobs: await prisma.importJob.findMany({
      where: { organisationId },
      orderBy: { id: 'asc' },
    }),
    history: await prisma.jobStatusHistory.findMany({
      where: { organisationId },
      orderBy: { id: 'asc' },
    }),
    trackers: await prisma.tracker.findMany({ where: { organisationId } }),
  });

  it('deletes only what is past the cut-off, in each workspace', async () => {
    const workspaces = [await workspace(), await workspace()];
    const expected = [];
    for (const w of workspaces) {
      const keep: string[] = [];
      for (const status of ['COMPLETED', 'CANCELLED']) {
        const old = await w.job(status, ago(90, -1));
        // Gone with its job, however recently the point was recorded.
        await w.points(old.id, ago(300));
        await w.points(old.id, ago(1));
        // Exactly 90 days is not yet past the period.
        const edge = await w.job(status, ago(90));
        keep.push(...(await w.points(edge.id, ago(300))));
      }
      const open = await w.job('NEW', null);
      keep.push(...(await w.points(open.id, ago(300))));
      await w.points(null, ago(90, -1));
      keep.push(...(await w.points(null, ago(90))));
      keep.push(...(await w.points(null, ago(1))));
      expected.push({ keep: keep.sort(), records: await records(w.id) });
    }
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await expect(retention().purge(NOW)).resolves.toEqual({
      closedJobs: 8,
      noJob: 2,
    });

    for (const [index, w] of workspaces.entries()) {
      expect(await remaining(w.id)).toEqual(expected[index].keep);
      expect(await records(w.id)).toEqual(expected[index].records);
    }
    expect(log.mock.calls).toEqual([
      ['Deleted 8 GPS points from closed jobs and 2 with no job'],
    ]);
    log.mockRestore();
    await expect(retention().purge(NOW)).resolves.toEqual({
      closedJobs: 0,
      noJob: 0,
    });
  });

  it('follows the configured period', async () => {
    const w = await workspace();
    const closed = await w.job('COMPLETED', ago(100));
    await w.points(closed.id, ago(100));
    await w.points(null, ago(100));
    await retention('180').purge(NOW);
    expect(await remaining(w.id)).toHaveLength(2);
    await retention('99').purge(NOW);
    expect(await remaining(w.id)).toHaveLength(0);
  });

  it('keeps the points of a job reopened before the period ends', async () => {
    const w = await workspace();
    const job = await w.job('COMPLETED', ago(60));
    const ids = await w.points(job.id, ago(300));
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'NEW', completedAt: null },
    });
    await retention().purge(new Date(NOW.getTime() + 60 * DAY));
    expect(await remaining(w.id)).toEqual(ids);
  });

  it('keeps the points of a job being reopened as it runs', async () => {
    const w = await workspace();
    const job = await w.job('COMPLETED', ago(120));
    const ids = await w.points(job.id, ago(120));
    let running: Promise<unknown> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.importJob.update({
        where: { id: job.id },
        data: { status: 'NEW', completedAt: null },
      });
      running = retention().purge(NOW);
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    await running;
    expect(await remaining(w.id)).toEqual(ids);
  });

  it('dates a closed job without a completion time from its last change', async () => {
    const w = await workspace();
    const job = await w.job('CANCELLED', null);
    await w.points(job.id, ago(300));
    await retention().purge(NOW);
    expect(await remaining(w.id)).toHaveLength(1);
    await prisma.importJob.update({
      where: { id: job.id },
      data: { updatedAt: ago(91) },
    });
    await retention().purge(NOW);
    expect(await remaining(w.id)).toHaveLength(0);
  });

  it('works through many batches, with two runs at once', async () => {
    const w = await workspace();
    const closed = await w.job('COMPLETED', ago(120));
    await w.points(closed.id, ago(120), 2500);
    await w.points(null, ago(120), 1500);
    const runs = await Promise.all([
      retention().purge(NOW),
      retention().purge(NOW),
    ]);
    // A run may leave rows the other holds locked. The next run takes them.
    runs.push(await retention().purge(NOW));
    expect(runs.reduce((sum, r) => sum + r.closedJobs, 0)).toBe(2500);
    expect(runs.reduce((sum, r) => sum + r.noJob, 0)).toBe(1500);
    expect(await remaining(w.id)).toHaveLength(0);
  });

  it('does not start with an unsafe period', () => {
    expect(() => retention('0')).toThrow('GPS_RETENTION_DAYS');
  });
});
