/**
 * GPS ownership and ingestion against a real PostgreSQL database. Skipped unless
 * TEST_DATABASE_URL names a scratch database that already has the schema:
 *
 *   DATABASE_URL=<scratch url> pnpm exec prisma db push --skip-generate
 *   TEST_DATABASE_URL=<scratch url> pnpm exec jest gps.db
 *
 * It removes the two GPS indexes to set up rows that predate them, so run it
 * alone (`--runInBand` when running every database test).
 */
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { FlespiIngestService } from '../integrations/flespi-ingest.service';
import { GpsProviderService } from '../integrations/gps-provider.service';
import { PrismaService } from '../prisma/prisma.service';
import { confirmDeviceOwner } from '../trackers/device-ownership';
import { TrackersService } from '../trackers/trackers.service';
import {
  GpsIndexesService,
  PING_INDEX,
  REAL_IMEI_INDEX,
} from './gps-indexes.service';
import { TrackingService } from './tracking.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;

const HOUR = 60 * 60 * 1000;

describeWithDatabase('GPS against PostgreSQL', () => {
  let prisma: PrismaService;
  let indexes: GpsIndexesService;
  let trackers: TrackersService;
  let ingest: FlespiIngestService;
  let tracking: TrackingService;
  let gateway: jest.Mock;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    indexes = new GpsIndexesService(prisma);
    trackers = new TrackersService(prisma, new AuditService(prisma));
    gateway = jest.fn();
    ingest = new FlespiIngestService(prisma, {
      configured: () => true,
      latestForImei: gateway,
    } as never);
    tracking = new TrackingService(prisma, new GpsProviderService(), {
      getConfig: () => ({}),
    } as never);
    await indexes.ensure();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const imei = () =>
    `35${Math.floor(Math.random() * 1e13)
      .toString()
      .padStart(13, '0')}`;

  async function workspace(slug: string = randomUUID()) {
    const organisation = await prisma.organisation.create({
      data: { name: slug, slug },
    });
    const account = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, name: 'Admin' },
    });
    return {
      slug,
      organisationId: organisation.id,
      user: {
        id: account.id,
        organisationId: organisation.id,
        role: 'ADMIN',
      } as AuthUser,
    };
  }

  type Workspace = Awaited<ReturnType<typeof workspace>>;

  async function job(w: Workspace, status = 'NEW') {
    const customer = await prisma.customer.create({
      data: {
        organisationId: w.organisationId,
        firstName: 'Test',
        lastName: 'Customer',
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: { organisationId: w.organisationId },
    });
    return prisma.importJob.create({
      data: {
        organisationId: w.organisationId,
        customerId: customer.id,
        vehicleId: vehicle.id,
        reference: randomUUID(),
        status,
      },
    });
  }

  /** A confirmed unit, owned since a day ago. */
  async function ownedUnit(w: Workspace, serial = imei()) {
    const { tracker } = await confirmDeviceOwner(prisma, serial, w.slug);
    return prisma.tracker.update({
      where: { id: tracker.id },
      data: { ownershipConfirmedAt: new Date(Date.now() - 24 * HOUR) },
    });
  }

  async function assignment(
    w: Workspace,
    trackerId: string,
    from: number,
    to?: number,
  ) {
    const target = await job(w);
    await prisma.trackerAssignment.create({
      data: {
        organisationId: w.organisationId,
        trackerId,
        vehicleId: target.vehicleId,
        importJobId: target.id,
        assignedAt: new Date(from),
        removedAt: to == null ? null : new Date(to),
      },
    });
    return target;
  }

  const message = (ident: string, at: number, battery?: number) => ({
    ident,
    timestamp: at / 1000,
    'position.latitude': 34.6841,
    'position.longitude': 33.0379,
    ...(battery == null ? {} : { 'battery.level': battery }),
  });

  const pingsOf = (trackerId: string) =>
    prisma.locationEvent.findMany({
      where: { trackerId },
      orderBy: { recordedAt: 'asc' },
    });

  const wholeSecond = (offset = 0) =>
    Math.floor((Date.now() + offset) / 1000) * 1000;

  describe('who may claim and receive a real unit', () => {
    it('lets one workspace register an IMEI when many try at once', async () => {
      const serial = imei();
      const spaced = `${serial.slice(0, 6)} ${serial.slice(6, 9)}-${serial.slice(9)}`;
      const all = await Promise.all(
        Array.from({ length: 6 }, () => workspace()),
      );
      const results = await Promise.allSettled(
        all.map((w, i) =>
          trackers.create(w.user, { serialNumber: i % 2 ? spaced : serial }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toMatchObject({ status: 409 });
        }
      }
      await expect(
        prisma.tracker.findMany({ where: { serialNumber: serial } }),
      ).resolves.toMatchObject([
        { provider: 'flespi', ownershipConfirmedAt: null },
      ]);
    });

    it('refuses a second claim in the database itself', async () => {
      const serial = imei();
      const [a, b] = [await workspace(), await workspace()];
      await trackers.create(a.user, { serialNumber: serial });
      await expect(
        prisma.tracker.create({
          data: {
            organisationId: b.organisationId,
            serialNumber: serial,
            provider: ' Teltonika ',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('lets simulated units share a serial', async () => {
      const [a, b] = [await workspace(), await workspace()];
      const dto = { serialNumber: 'TRK-001', provider: 'generic' };
      await trackers.create(a.user, dto);
      await trackers.create(b.user, dto);
      await expect(trackers.create(b.user, dto)).rejects.toMatchObject({
        status: 409,
      });
    });

    it('gives nothing to a claim until the operator confirms it', async () => {
      const serial = imei();
      const w = await workspace();
      const claim = await trackers.create(w.user, { serialNumber: serial });
      await assignment(w, claim.id, Date.now() - HOUR);
      await expect(
        ingest.ingestBody([message(serial, wholeSecond())]),
      ).resolves.toMatchObject({ accepted: 0, unknown: 1 });
      await expect(
        ingest.syncTracker(w.organisationId, claim.id),
      ).rejects.toMatchObject({ status: 403 });
      expect(gateway).not.toHaveBeenCalled();
      expect(await pingsOf(claim.id)).toHaveLength(0);
      await expect(
        prisma.tracker.findUnique({ where: { id: claim.id } }),
      ).resolves.toMatchObject({ lastSeenAt: null });
    });

    it('never gives a simulated unit with the same serial a position', async () => {
      const serial = imei();
      const [owner, other] = [await workspace(), await workspace()];
      const owned = await ownedUnit(owner, serial);
      await assignment(owner, owned.id, Date.now() - HOUR);
      const copy = await trackers.create(other.user, {
        serialNumber: serial,
        provider: 'generic',
      });
      await assignment(other, copy.id, Date.now() - HOUR);
      await ingest.ingestBody([message(serial, wholeSecond())]);
      expect(await pingsOf(owned.id)).toHaveLength(1);
      expect(await pingsOf(copy.id)).toHaveLength(0);
      await expect(
        ingest.syncTracker(other.organisationId, owned.id),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('moves a unit to the proven owner and holds back earlier positions', async () => {
      const serial = imei();
      const [squatter, owner] = [await workspace(), await workspace()];
      const claim = await trackers.create(squatter.user, {
        serialNumber: serial,
      });
      await assignment(squatter, claim.id, Date.now() - HOUR);
      await confirmDeviceOwner(prisma, serial, squatter.slug);
      const confirmed = await confirmDeviceOwner(prisma, serial, owner.slug);
      expect(confirmed.disputed).toBe(1);
      await assignment(owner, confirmed.tracker.id, Date.now() - HOUR);
      const since = confirmed.tracker.ownershipConfirmedAt!.getTime();
      gateway.mockResolvedValue(
        [since - 60_000, since + 2000].map((at) => ({
          ident: serial,
          latitude: 35,
          longitude: 33,
          recordedAt: new Date(at),
          speed: null,
          heading: null,
          accuracy: null,
          batteryLevel: null,
        })),
      );
      await expect(
        ingest.syncTracker(owner.organisationId, confirmed.tracker.id),
      ).resolves.toEqual({ received: 2, accepted: 1, skipped: 1 });
      expect(await pingsOf(claim.id)).toHaveLength(0);
      await expect(
        ingest.syncTracker(squatter.organisationId, claim.id),
      ).rejects.toMatchObject({ status: 403 });
      // Running it again changes nothing.
      const again = await confirmDeviceOwner(prisma, serial, owner.slug);
      expect(again.tracker.ownershipConfirmedAt).toEqual(
        confirmed.tracker.ownershipConfirmedAt,
      );
    });
  });

  describe('ingestion', () => {
    it('saves each ping once when the same batch arrives many times at once', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w);
      await assignment(w, unit.id, Date.now() - 2 * HOUR);
      const start = wholeSecond(-HOUR);
      const batch = Array.from({ length: 1200 }, (_, i) =>
        message(unit.serialNumber, start + i * 1000),
      );
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          ingest.ingestBody([...batch, batch[0]]),
        ),
      );
      expect(await pingsOf(unit.id)).toHaveLength(1200);
      expect(results.reduce((sum, r) => sum + r.accepted, 0)).toBe(1200);
      expect(results.reduce((sum, r) => sum + r.skipped, 0)).toBe(
        4 * 1201 - 1200,
      );
    });

    it('puts a buffered ping on the job the unit was on at the time', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w);
      const now = wholeSecond();
      const old = await assignment(w, unit.id, now - 5 * HOUR, now - 3 * HOUR);
      const current = await assignment(w, unit.id, now - HOUR);
      const result = await ingest.ingestBody([
        message(unit.serialNumber, now - 4 * HOUR),
        message(unit.serialNumber, now - 2 * HOUR),
        message(unit.serialNumber, now - HOUR / 2),
      ]);
      expect(result.accepted).toBe(3);
      expect((await pingsOf(unit.id)).map((p) => p.importJobId)).toEqual([
        old.id,
        current.id,
      ]);
    });

    it('moves lastSeenAt and the battery only forwards', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w);
      const now = wholeSecond();
      await ingest.ingestBody([message(unit.serialNumber, now - HOUR, 50)]);
      await ingest.ingestBody([message(unit.serialNumber, now - 2 * HOUR, 90)]);
      await expect(
        prisma.tracker.findUnique({ where: { id: unit.id } }),
      ).resolves.toMatchObject({
        lastSeenAt: new Date(now - HOUR),
        batteryLevel: 50,
      });
      // A clock running ahead counts as now, and a wild one is dropped.
      await ingest.ingestBody([
        message(unit.serialNumber, now + HOUR),
        message(unit.serialNumber, now + 48 * HOUR),
      ]);
      const after = await prisma.tracker.findUniqueOrThrow({
        where: { id: unit.id },
      });
      expect(after.lastSeenAt!.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('keeps a staff position off a job it was recorded before', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w);
      const target = await assignment(w, unit.id, Date.now() - HOUR);
      const add = (offset: number) =>
        trackers.addLocation(w.user, unit.id, {
          latitude: 35,
          longitude: 33,
          recordedAt: new Date(wholeSecond(offset)).toISOString(),
        });
      await expect(add(-2 * HOUR)).resolves.toMatchObject({
        importJobId: null,
      });
      await expect(add(-HOUR / 2)).resolves.toMatchObject({
        importJobId: target.id,
      });
    });
  });

  describe('the simulator', () => {
    const demo = async () => {
      const existing = await prisma.organisation.findUnique({
        where: { slug: 'demo-imports' },
      });
      if (existing) {
        const account = await prisma.user.create({
          data: { email: `${randomUUID()}@example.test`, name: 'Admin' },
        });
        return {
          slug: existing.slug,
          organisationId: existing.id,
          user: {
            id: account.id,
            organisationId: existing.id,
            role: 'ADMIN',
          } as AuthUser,
        };
      }
      return workspace('demo-imports');
    };

    async function simulated(w: Workspace, status: string) {
      const target = await job(w, status);
      const unit = await trackers.create(w.user, {
        serialNumber: randomUUID(),
        provider: 'generic',
      });
      await trackers.assign(w.user, target.id, { trackerId: unit.id });
      return target;
    }

    it('builds one trail when a demo status change runs twice at once', async () => {
      const w = await demo();
      const target = await simulated(w, 'ARRIVED_CYPRUS');
      await Promise.all(
        Array.from({ length: 3 }, () =>
          tracking.alignToStatus(target.id, w.organisationId, 'ARRIVED_CYPRUS'),
        ),
      );
      const points = await prisma.locationEvent.findMany({
        where: { importJobId: target.id },
      });
      expect(points.length).toBeGreaterThan(1);
      expect(
        new Set(points.map((p) => [p.latitude, p.longitude].join())).size,
      ).toBe(points.length);
    });

    it('adds nothing when a job’s tracking is read', async () => {
      const w = await demo();
      const target = await simulated(w, 'ARRIVED_CYPRUS');
      await tracking.forJob(w.user, target.id);
      expect(
        await prisma.locationEvent.count({
          where: { importJobId: target.id },
        }),
      ).toBe(0);
    });

    it('advances one step per request, even at once', async () => {
      const w = await workspace();
      const target = await simulated(w, 'ARRIVED_CYPRUS');
      const points = await Promise.all(
        Array.from({ length: 3 }, () => tracking.advance(w.user, target.id)),
      );
      expect(new Set(points.map((p) => p.recordedAt)).size).toBe(3);
    });
  });

  describe('starting up over rows that predate the rules', () => {
    beforeAll(async () => {
      await prisma.$executeRawUnsafe(`DROP INDEX "${REAL_IMEI_INDEX}"`);
      await prisma.$executeRawUnsafe(`DROP INDEX "${PING_INDEX}"`);
    });

    it('disputes every duplicate claim, keeps every ping and can run again', async () => {
      const serial = imei();
      const claims = [];
      for (const provider of ['flespi', 'teltonika']) {
        const w = await workspace();
        claims.push(
          await prisma.tracker.create({
            data: {
              organisationId: w.organisationId,
              serialNumber: serial,
              provider,
              ownershipConfirmedAt: new Date(0),
            },
          }),
        );
      }
      const w = await workspace();
      const target = await job(w);
      const unit = await prisma.tracker.create({
        data: { organisationId: w.organisationId, serialNumber: imei() },
      });
      const at = new Date('2026-01-01T00:00:00Z');
      const copy = (importJobId?: string) =>
        prisma.locationEvent.create({
          data: {
            organisationId: w.organisationId,
            trackerId: unit.id,
            importJobId,
            latitude: 35,
            longitude: 33,
            recordedAt: at,
          },
        });
      await copy();
      const onJob = await copy(target.id);
      await copy();

      // Two copies of the API starting at once must both succeed.
      await Promise.all([indexes.ensure(), indexes.ensure()]);
      await expect(indexes.ensure()).resolves.toEqual({
        claims: 0,
        pings: 0,
      });

      const after = await prisma.tracker.findMany({
        where: { id: { in: claims.map((c) => c.id) } },
      });
      for (const claim of after) {
        expect(claim.imeiConflictAt).not.toBeNull();
        expect(claim.ownershipConfirmedAt).toBeNull();
      }
      const kept = await pingsOf(unit.id);
      expect(kept).toHaveLength(3);
      expect(kept.filter((p) => !p.isDuplicate)).toMatchObject([
        { id: onJob.id },
      ]);
      // A third claim is still refused, and the dispute blocks delivery.
      const third = await workspace();
      await expect(
        trackers.create(third.user, { serialNumber: serial }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        ingest.ingestBody([message(serial, wholeSecond())]),
      ).resolves.toMatchObject({ unknown: 1 });
    });

    it('stops the start when the indexes cannot be made', async () => {
      const failing = jest
        .spyOn(prisma, '$transaction')
        .mockRejectedValueOnce(new Error('no room for the index'));
      await expect(indexes.onApplicationBootstrap()).rejects.toThrow(
        'no room for the index',
      );
      failing.mockRestore();
    });
  });
});
