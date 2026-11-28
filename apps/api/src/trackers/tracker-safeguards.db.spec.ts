/**
 * The safeguards for units that clients bring themselves, against a real
 * PostgreSQL database. Skipped unless TEST_DATABASE_URL names a scratch
 * database that already has the schema:
 *
 *   DATABASE_URL=<scratch url> pnpm run db:deploy
 *   TEST_DATABASE_URL=<scratch url> pnpm exec jest tracker-safeguards.db
 */
import { randomUUID } from 'node:crypto';
import { TRACKER_STATEMENT_VERSION } from '@vip/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { trackerAlerts } from '../dashboard/tracker-alerts';
import { FlespiIngestService } from '../integrations/flespi-ingest.service';
import { PrismaService } from '../prisma/prisma.service';
import { GpsRetentionService } from '../tracking/gps-retention.service';
import { confirmDeviceOwner } from './device-ownership';
import { TrackersService } from './trackers.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const imei = () =>
  `35${Math.floor(Math.random() * 1e13)
    .toString()
    .padStart(13, '0')}`;

/** An audit entry is written after the reply, so it is waited for. */
async function eventually<T>(read: () => Promise<T | null>): Promise<T | null> {
  for (let tries = 0; tries < 50; tries += 1) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

const statement = {
  statementConfirmed: true,
  statementVersion: TRACKER_STATEMENT_VERSION,
};

describeWithDatabase('tracker safeguards against PostgreSQL', () => {
  let prisma: PrismaService;
  let trackers: TrackersService;
  let ingest: FlespiIngestService;
  let lowBattery: jest.Mock;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    trackers = new TrackersService(prisma, new AuditService(prisma));
    lowBattery = jest.fn();
    ingest = new FlespiIngestService(
      prisma,
      { configured: () => false } as never,
      { get: () => undefined } as never,
      { sendLowBattery: lowBattery } as never,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function workspace() {
    const slug = randomUUID();
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

  /** A confirmed real unit, owned since a day ago. */
  async function ownedUnit(w: Workspace, data: Record<string, unknown> = {}) {
    const serial = imei();
    await trackers.create(w.user, { serialNumber: serial, ...statement });
    const { tracker } = await confirmDeviceOwner(
      prisma,
      serial,
      w.slug,
      'invoice',
    );
    return prisma.tracker.update({
      where: { id: tracker.id },
      data: { ownershipConfirmedAt: new Date(Date.now() - DAY), ...data },
    });
  }

  const ping = (ident: string, at: number, extra: object = {}) => ({
    ident,
    timestamp: Math.floor(at / 1000),
    'position.latitude': 34.6841,
    'position.longitude': 33.0379,
    ...extra,
  });

  const alertsFor = (w: Workspace) =>
    trackerAlerts(prisma, {
      organisationId: w.organisationId,
      now: new Date(),
      perKind: 25,
      lowBatteryPercent: 20,
      lowSupplyVolts: 11.8,
      afterJobGraceHours: 24,
    });

  describe('registering a real unit', () => {
    it('refuses it without the lawful-use statement', async () => {
      const w = await workspace();
      await expect(
        trackers.create(w.user, { serialNumber: imei() }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        trackers.create(w.user, {
          serialNumber: imei(),
          statementConfirmed: true,
          statementVersion: '2000-01-01',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('records who confirmed which statement, and audits it', async () => {
      const w = await workspace();
      const unit = await trackers.create(w.user, {
        serialNumber: imei(),
        powerSource: 'HARD_WIRED',
        reportIntervalMinutes: 15,
        ...statement,
      });
      expect(unit).toMatchObject({
        powerSource: 'HARD_WIRED',
        reportIntervalMinutes: 15,
        statementConfirmedById: w.user.id,
        statementVersion: TRACKER_STATEMENT_VERSION,
      });
      expect(unit.statementConfirmedAt).toBeInstanceOf(Date);
      await expect(
        eventually(() =>
          prisma.auditLog.findFirst({
            where: { entityId: unit.id, action: 'TRACKER_REGISTERED' },
          }),
        ),
      ).resolves.toMatchObject({ actorId: w.user.id });
    });

    it('needs no statement for a demo unit', async () => {
      const w = await workspace();
      await expect(
        trackers.create(w.user, {
          serialNumber: 'TRK-001',
          provider: 'generic',
        }),
      ).resolves.toMatchObject({ statementConfirmedAt: null });
    });

    it('records the kind of proof when the operator confirms the owner', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w);
      await expect(
        prisma.auditLog.findFirst({
          where: { entityId: unit.id, action: 'TRACKER_OWNERSHIP_CONFIRMED' },
        }),
      ).resolves.toMatchObject({
        actorId: null,
        metadata: expect.objectContaining({ proof: 'invoice' }),
      });
    });
  });

  describe('fitting and removal', () => {
    it('keeps a wired unit off a job until a fitter and permission are recorded', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w, { powerSource: 'HARD_WIRED' });
      const target = await job(w);
      await expect(
        trackers.assign(w.user, target.id, { trackerId: unit.id }),
      ).rejects.toMatchObject({ status: 400 });
      await trackers.update(w.user, unit.id, {
        fittedBy: 'Auto Electrics Ltd',
        ownerPermissionHeld: true,
      });
      await expect(
        trackers.assign(w.user, target.id, { trackerId: unit.id }),
      ).resolves.toMatchObject({ trackerId: unit.id });
    });

    it('asks for a real unit to be confirmed as taken out after it comes off a job', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w);
      const target = await job(w);
      const on = await trackers.assign(w.user, target.id, {
        trackerId: unit.id,
      });
      const off = await trackers.unassign(w.user, on.id);
      expect(off).toMatchObject({
        removalRequired: true,
        removalConfirmedAt: null,
      });
      const alerts = await alertsFor(w);
      expect(alerts.shown).toEqual([
        expect.objectContaining({
          kind: 'REMOVAL_UNCONFIRMED',
          importJobId: target.id,
        }),
      ]);
      await trackers.confirmRemoval(w.user, on.id, { unitRemoved: true });
      expect((await alertsFor(w)).total).toBe(0);
    });

    it('needs the fitter’s name to confirm a wired unit was taken out', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w, {
        powerSource: 'OBD',
        fittedBy: 'Fitter',
        ownerPermissionHeld: true,
      });
      const target = await job(w);
      const on = await trackers.assign(w.user, target.id, {
        trackerId: unit.id,
      });
      await expect(
        trackers.unassign(w.user, on.id, { unitRemoved: true }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        trackers.unassign(w.user, on.id, {
          unitRemoved: true,
          removalFitter: 'Fitter',
        }),
      ).resolves.toMatchObject({ removalFitter: 'Fitter' });
    });

    it('asks for the old unit to be taken out when it is replaced', async () => {
      const w = await workspace();
      const [first, second] = [await ownedUnit(w), await ownedUnit(w)];
      const target = await job(w);
      const old = await trackers.assign(w.user, target.id, {
        trackerId: first.id,
      });
      await trackers.assign(w.user, target.id, { trackerId: second.id });
      await expect(
        prisma.trackerAssignment.findUniqueOrThrow({ where: { id: old.id } }),
      ).resolves.toMatchObject({ removalRequired: true });
    });

    it('flags a closed job that still has a real unit on it', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w);
      const target = await job(w);
      await trackers.assign(w.user, target.id, { trackerId: unit.id });
      await prisma.importJob.update({
        where: { id: target.id },
        data: { status: 'COMPLETED' },
      });
      expect((await alertsFor(w)).shown).toEqual([
        expect.objectContaining({
          kind: 'REMOVAL_UNCONFIRMED',
          detail: expect.stringContaining('still assigned'),
        }),
      ]);
    });

    it('flags a unit still reporting a day after its job', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w);
      const target = await job(w);
      const on = await trackers.assign(w.user, target.id, {
        trackerId: unit.id,
      });
      await trackers.unassign(w.user, on.id, { unitRemoved: true });
      await prisma.trackerAssignment.update({
        where: { id: on.id },
        data: { removedAt: new Date(Date.now() - 2 * DAY) },
      });
      await ingest.ingestBody([ping(unit.serialNumber, Date.now() - MINUTE)]);
      expect((await alertsFor(w)).shown).toEqual([
        expect.objectContaining({
          kind: 'REPORTING_AFTER_JOB',
          importJobId: target.id,
        }),
      ]);
    });
  });

  describe('signal and batteries', () => {
    it('calls a unit quiet only after two of its own reports are missed', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w, {
        reportIntervalMinutes: 6 * 60,
        lastSeenAt: new Date(Date.now() - 10 * HOUR),
      });
      const target = await job(w);
      await trackers.assign(w.user, target.id, { trackerId: unit.id });
      expect((await alertsFor(w)).total).toBe(0);
      await prisma.tracker.update({
        where: { id: unit.id },
        data: { lastSeenAt: new Date(Date.now() - 13 * HOUR) },
      });
      expect((await alertsFor(w)).shown).toEqual([
        expect.objectContaining({
          kind: 'STALE_TRACKER',
          detail: expect.stringContaining('12 hours'),
        }),
      ]);
    });

    it('emails once when a battery unit runs low, and again after a recharge', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w);
      const target = await job(w);
      await trackers.assign(w.user, target.id, { trackerId: unit.id });
      lowBattery.mockClear();
      const send = (battery: number, ago: number) =>
        ingest.ingestBody([
          ping(unit.serialNumber, Date.now() - ago, {
            'battery.level': battery,
          }),
        ]);
      await send(18, 5 * MINUTE);
      await send(15, 4 * MINUTE);
      expect(lowBattery).toHaveBeenCalledTimes(1);
      expect(lowBattery).toHaveBeenCalledWith(
        expect.objectContaining({ importJobId: target.id, batteryLevel: 18 }),
      );
      expect((await alertsFor(w)).shown).toEqual([
        expect.objectContaining({ kind: 'LOW_BATTERY' }),
      ]);
      await send(80, 3 * MINUTE);
      await send(12, 2 * MINUTE);
      expect(lowBattery).toHaveBeenCalledTimes(2);
    });

    it('warns when a wired unit reads a low vehicle battery', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w, {
        powerSource: 'HARD_WIRED',
        fittedBy: 'Fitter',
        ownerPermissionHeld: true,
      });
      const target = await job(w);
      await trackers.assign(w.user, target.id, { trackerId: unit.id });
      await ingest.ingestBody([
        ping(unit.serialNumber, Date.now() - MINUTE, {
          'external.powersource.voltage': 11.2,
        }),
      ]);
      expect((await alertsFor(w)).shown).toEqual([
        expect.objectContaining({ kind: 'LOW_VEHICLE_BATTERY' }),
      ]);
    });
  });

  describe('where positions come from', () => {
    it('labels a position typed in by staff', async () => {
      const w = await workspace();
      const unit = await ownedUnit(w);
      const point = await trackers.addLocation(w.user, unit.id, {
        latitude: 35,
        longitude: 33,
      });
      expect(point.source).toBe('MANUAL');
    });

    it('lets a workspace’s own gateway account reach only its own units', async () => {
      const [mine, theirs] = [await workspace(), await workspace()];
      const own = await ownedUnit(mine);
      const other = await ownedUnit(theirs);
      const result = await ingest.ingestBody(
        [
          ping(own.serialNumber, Date.now() - MINUTE),
          ping(other.serialNumber, Date.now() - MINUTE),
        ],
        mine.organisationId,
      );
      expect(result).toMatchObject({ received: 2, accepted: 1, unknown: 1 });
    });
  });

  describe('retention', () => {
    it('keeps a workspace’s positions for the period it chose', async () => {
      const now = new Date('2001-06-01T12:00:00.000Z');
      const [short, standard] = [await workspace(), await workspace()];
      await prisma.organisationSettings.create({
        data: { organisationId: short.organisationId, gpsRetentionDays: 30 },
      });
      for (const w of [short, standard]) {
        await prisma.locationEvent.create({
          data: {
            organisationId: w.organisationId,
            latitude: 35,
            longitude: 33,
            recordedAt: new Date(now.getTime() - 45 * DAY),
          },
        });
      }
      const retention = new GpsRetentionService(prisma, {
        get: () => undefined,
      } as never);
      await retention.purge(now);
      const left = async (w: Workspace) =>
        prisma.locationEvent.count({
          where: { organisationId: w.organisationId },
        });
      expect(await left(short)).toBe(0);
      expect(await left(standard)).toBe(1);
    });
  });
});
