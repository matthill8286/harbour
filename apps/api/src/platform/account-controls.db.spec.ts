/**
 * Suspension, switching workspaces and plan rules over real HTTP, with two
 * workspaces, against a real PostgreSQL database. Skipped unless
 * TEST_DATABASE_URL names a scratch database that already has the schema:
 *
 *   DATABASE_URL=<scratch url> pnpm exec prisma db push --skip-generate
 *   TEST_DATABASE_URL=<scratch url> pnpm exec jest db.spec
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hash } from 'argon2';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { SecretBox } from '../auth/two-factor/secret-box';
import {
  generateBackupCodes,
  generateTotpSecret,
  normaliseBackupCode,
} from '../auth/two-factor/totp';
import { NotificationsService } from '../integrations/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PLAN_LIMITS } from '../tenancy/plan-policy';
import { UsageService } from '../tenancy/usage.service';
import { confirmDeviceOwner } from '../trackers/device-ownership';
import { GpsIndexesService } from '../tracking/gps-indexes.service';
import { GpsRetentionService } from '../tracking/gps-retention.service';
import { WorkflowRoutesService } from '../workflow/workflow-routes.service';
import { runOperatorCommand } from './operator-command';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;
const PASSWORD = 'correct horse battery';
const HOUR = 60 * 60 * 1000;

describeWithDatabase('account controls across two workspaces', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let uploads: string;
  let secretKey: string;
  let webhookSecret: string;
  let passwordHash: string;
  const env = { ...process.env };

  beforeAll(async () => {
    uploads = await mkdtemp(join(tmpdir(), 'harbour-accounts-'));
    secretKey = randomUUID() + randomUUID();
    webhookSecret = randomUUID();
    Object.assign(process.env, {
      DATABASE_URL: url,
      JWT_SECRET: randomUUID() + randomUUID(),
      TWO_FACTOR_ENCRYPTION_KEY: secretKey,
      STORAGE_LOCAL_DIR: uploads,
      EMAIL_PROVIDER: 'log',
      AI_PROVIDER: 'log',
      FLESPI_WEBHOOK_SECRET: webhookSecret,
    });
    for (const service of [
      UsageService,
      GpsIndexesService,
      GpsRetentionService,
      WorkflowRoutesService,
    ]) {
      jest
        .spyOn(service.prototype, 'onApplicationBootstrap')
        .mockImplementation(() => Promise.resolve());
    }
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureApp(app, {});
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    passwordHash = await hash(PASSWORD);
  });

  afterAll(async () => {
    await app?.close();
    await rm(uploads, { recursive: true, force: true });
    process.env = env;
    jest.restoreAllMocks();
  });

  async function workspace(name: string) {
    const slug = `${name}-${randomUUID()}`;
    const organisation = await prisma.organisation.create({
      data: { name, slug, subscription: { create: {} } },
    });
    return organisation;
  }
  type Workspace = Awaited<ReturnType<typeof workspace>>;

  /** An account with two-factor on, and its backup codes. */
  async function person(twoFactor = true) {
    const codes = generateBackupCodes();
    const box = new SecretBox(secretKey);
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        name: 'Pat Example',
        passwordHash,
        twoFactorEnabled: twoFactor,
        ...(twoFactor
          ? {
              twoFactor: {
                create: {
                  secret: box.encrypt(generateTotpSecret()),
                  backupCodes: box.encrypt(
                    JSON.stringify(codes.map(normaliseBackupCode)),
                  ),
                  verified: true,
                },
              },
            }
          : {}),
      },
    });
    return { ...user, codes };
  }
  type Person = Awaited<ReturnType<typeof person>>;

  const addMember = (
    who: Person,
    where: Workspace,
    role: 'ADMIN' | 'STAFF' = 'ADMIN',
  ) =>
    prisma.organisationMembership.create({
      data: {
        organisationId: where.id,
        userId: who.id,
        role,
        status: 'ACTIVE',
        acceptedAt: new Date(),
      },
    });

  const tokenFor = (who: Person, membershipId?: string, expiresIn = 60 * 60) =>
    app
      .get(JwtService, { strict: false })
      .signAsync({ sub: who.id, membershipId }, { expiresIn });

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (path: string) =>
      http().get(`/api${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object = {}) =>
      http()
        .post(`/api${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body),
    patch: (path: string, body: object) =>
      http()
        .patch(`/api${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body),
  });

  async function operator() {
    const who = await person();
    await runOperatorCommand(prisma, ['grant', who.email]);
    return who;
  }

  const suspend = (by: Person, target: Workspace) =>
    runOperatorCommand(prisma, [
      'suspend',
      target.slug,
      '--by',
      by.email,
      '--reason',
      'Reported misuse, ticket 12',
    ]);
  const restore = (by: Person, target: Workspace) =>
    runOperatorCommand(prisma, [
      'restore',
      target.slug,
      '--by',
      by.email,
      '--reason',
      'Ticket 12 is resolved',
    ]);

  describe('the platform operator role', () => {
    it('goes only to an account with a password and two-factor', async () => {
      const weak = await person(false);
      await expect(
        runOperatorCommand(prisma, ['grant', weak.email]),
      ).rejects.toThrow('two-factor');
      await expect(
        runOperatorCommand(prisma, ['grant', 'nobody@example.test']),
      ).rejects.toThrow('no account');
      expect(
        await prisma.platformAdmin.count({ where: { userId: weak.id } }),
      ).toBe(0);
    });

    it('is needed to suspend, with a reason, and stops working once revoked', async () => {
      const target = await workspace('role');
      const outsider = await person();
      await addMember(outsider, target);
      await expect(suspend(outsider, target)).rejects.toThrow(
        'not a platform operator',
      );
      const by = await operator();
      await expect(
        runOperatorCommand(prisma, [
          'suspend',
          target.slug,
          '--by',
          by.email,
          '--reason',
          '  short ',
        ]),
      ).rejects.toThrow('Give a reason');
      await runOperatorCommand(prisma, ['revoke', by.email]);
      await expect(suspend(by, target)).rejects.toThrow(
        'not a platform operator',
      );
      const after = await prisma.organisation.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(after.status).toBe('ACTIVE');
      expect(
        await prisma.platformAuditLog.findMany({
          where: { targetId: by.id },
          orderBy: { createdAt: 'asc' },
          select: { action: true },
        }),
      ).toEqual([
        { action: 'OPERATOR_GRANTED' },
        { action: 'OPERATOR_REVOKED' },
      ]);
    });
  });

  describe('suspension', () => {
    it('blocks sign-in and the API for that workspace only, and deletes nothing', async () => {
      const [a, b] = [await workspace('a'), await workspace('b')];
      const [inA, inB] = [await person(), await person()];
      const tokenA = await tokenFor(inA, (await addMember(inA, a)).id);
      const tokenB = await tokenFor(inB, (await addMember(inB, b)).id);
      await as(tokenA)
        .post('/customers', { firstName: 'Ada', lastName: 'A' })
        .expect(201);
      const by = await operator();
      const counts = () =>
        Promise.all([
          prisma.customer.count({ where: { organisationId: a.id } }),
          prisma.organisationMembership.count({
            where: { organisationId: a.id },
          }),
        ]);
      const before = await counts();

      await suspend(by, a);

      await as(tokenA).get('/customers').expect(401);
      await as(tokenA).get('/auth/me').expect(401);
      await as(tokenB).get('/customers').expect(200);
      const signIn = await http()
        .post('/api/auth/login')
        .send({ email: inA.email, password: PASSWORD })
        .expect(401);
      expect(signIn.body.message).toContain('suspended');
      const wrong = await http()
        .post('/api/auth/login')
        .send({ email: inA.email, password: 'not it at all' })
        .expect(401);
      expect(wrong.body.message).not.toContain('suspended');
      await expect(suspend(by, a)).rejects.toThrow('not active');
      expect(await counts()).toEqual(before);

      const record = await prisma.workspaceSuspension.findMany({
        where: { organisationId: a.id },
      });
      expect(record).toEqual([
        expect.objectContaining({
          reason: 'Reported misuse, ticket 12',
          suspendedById: by.id,
          restoredAt: null,
        }),
      ]);

      await restore(by, a);
      await as(tokenA).get('/customers').expect(200);
      expect(
        await prisma.workspaceSuspension.findFirstOrThrow({
          where: { organisationId: a.id },
        }),
      ).toMatchObject({ restoredById: by.id, restoredAt: expect.any(Date) });
      await expect(restore(by, a)).rejects.toThrow('not suspended');
    });

    it('stops invite links, a half-finished sign-in and switching into it', async () => {
      const [a, b] = [await workspace('a'), await workspace('b')];
      const both = await person();
      const inB = await addMember(both, b);
      const inA = await addMember(both, a);
      // Sign-in picks the newest membership. Two made in the same millisecond
      // have no newest, so the other one is dated clearly earlier.
      await prisma.organisationMembership.update({
        where: { id: inB.id },
        data: { createdAt: new Date(Date.now() - HOUR) },
      });
      const challenge = await http()
        .post('/api/auth/login')
        .send({ email: both.email, password: PASSWORD })
        .expect(201);
      await suspend(await operator(), a);

      // The newest membership is the suspended one, and it is what was chosen.
      await http()
        .post('/api/auth/two-factor/challenge')
        .send({
          challengeToken: challenge.body.challengeToken,
          backupCode: both.codes[0],
        })
        .expect(401);
      const tokenB = await tokenFor(both, inB.id);
      const list = await as(tokenB).get('/auth/organisations').expect(200);
      expect(
        list.body.map((item: { membershipId: string }) => item.membershipId),
      ).toEqual([inB.id]);
      await as(tokenB)
        .post('/auth/organisations/switch', {
          membershipId: inA.id,
          backupCode: both.codes[1],
        })
        .expect(404);
    });

    it('stops that workspace sending email, and not another', async () => {
      const [a, b] = [await workspace('a'), await workspace('b')];
      const customers = await Promise.all(
        [a, b].map((org) =>
          prisma.customer.create({
            data: {
              organisationId: org.id,
              firstName: 'Cara',
              lastName: 'Example',
              email: `${randomUUID()}@example.test`,
            },
          }),
        ),
      );
      await suspend(await operator(), a);
      const mail = app.get(NotificationsService, { strict: false });
      const portal = (org: Workspace, customerId: string) =>
        mail.sendPortalInvite({
          type: 'PORTAL_INVITE',
          organisationId: org.id,
          customerId,
          inviteUrl: 'http://localhost:5173/invite/x',
          message: 'Portal invite',
        });
      const staff = (org: Workspace) =>
        mail.sendStaffInvite(
          'someone@example.test',
          { brandName: org.name, roleLabel: 'Staff', inviteUrl: 'http://x' },
          org.id,
        );
      await expect(portal(a, customers[0].id)).resolves.toBe(false);
      await expect(staff(a)).resolves.toBe(false);
      await expect(portal(b, customers[1].id)).resolves.toBe(true);
      await expect(staff(b)).resolves.toBe(true);
    });

    it('takes in no GPS position recorded while suspended, even afterwards', async () => {
      const [a, b] = [await workspace('a'), await workspace('b')];
      const unit = async (org: Workspace) => {
        const serial = `35${Math.floor(Math.random() * 1e13)
          .toString()
          .padStart(13, '0')}`;
        const { tracker } = await confirmDeviceOwner(prisma, serial, org.slug);
        await prisma.tracker.update({
          where: { id: tracker.id },
          data: { ownershipConfirmedAt: new Date(Date.now() - 24 * HOUR) },
        });
        // On a job, so that its positions are kept.
        const vehicle = await prisma.vehicle.create({
          data: { organisationId: org.id },
        });
        await prisma.trackerAssignment.create({
          data: {
            organisationId: org.id,
            trackerId: tracker.id,
            vehicleId: vehicle.id,
            assignedAt: new Date(Date.now() - 24 * HOUR),
          },
        });
        return { serial, id: tracker.id };
      };
      const [unitA, unitB] = [await unit(a), await unit(b)];
      const send = (serial: string, at: number) =>
        http()
          .post('/api/integrations/gps/flespi')
          .set('x-harbour-gps-secret', webhookSecret)
          .send([
            {
              ident: serial,
              timestamp: Math.floor(at / 1000),
              'position.latitude': 34.7,
              'position.longitude': 33.1,
            },
          ])
          .expect((response) => expect(response.status).toBeLessThan(300));
      const saved = (id: string) =>
        prisma.locationEvent.count({ where: { trackerId: id } });

      const by = await operator();
      const suspendedAt = Date.now() - 2 * HOUR;
      await suspend(by, a);
      await prisma.workspaceSuspension.updateMany({
        where: { organisationId: a.id },
        data: { suspendedAt: new Date(suspendedAt) },
      });
      await send(unitA.serial, Date.now() - HOUR);
      await send(unitB.serial, Date.now() - HOUR);
      expect([await saved(unitA.id), await saved(unitB.id)]).toEqual([0, 1]);

      await restore(by, a);
      await send(unitA.serial, Date.now() - HOUR + 5000);
      expect(await saved(unitA.id)).toBe(0);
      await send(unitA.serial, suspendedAt - HOUR);
      await send(unitA.serial, Date.now() + 2000);
      expect(await saved(unitA.id)).toBe(2);
    });
  });

  describe('switching workspaces', () => {
    it('issues a session for the other workspace after a fresh code, and records it', async () => {
      const [a, b] = [await workspace('alpha'), await workspace('beta')];
      const both = await person();
      const [inA, inB] = [
        await addMember(both, a),
        await addMember(both, b, 'STAFF'),
      ];
      await prisma.customer.create({
        data: { organisationId: a.id, firstName: 'Only', lastName: 'Alpha' },
      });
      const tokenA = await tokenFor(both, inA.id, 600);

      const list = await as(tokenA).get('/auth/organisations').expect(200);
      expect(list.body).toEqual([
        { membershipId: inA.id, name: 'alpha', role: 'ADMIN', current: true },
        { membershipId: inB.id, name: 'beta', role: 'STAFF', current: false },
      ]);

      const move = (body: object) =>
        as(tokenA).post('/auth/organisations/switch', body);
      const none = await move({ membershipId: inB.id }).expect(400);
      expect(none.body.code).toBe('switch_two_factor_required');
      await move({ membershipId: inB.id, backupCode: 'wrong-code' }).expect(
        400,
      );
      const switched = await move({
        membershipId: inB.id,
        backupCode: both.codes[0],
      }).expect(201);

      expect(switched.body.user).toMatchObject({
        organisationId: b.id,
        membershipId: inB.id,
        role: 'STAFF',
      });
      const there = await as(switched.body.accessToken)
        .get('/customers')
        .expect(200);
      expect(there.body.items).toEqual([]);
      // The new session ends no later than the one it replaces.
      const expiry = (token: string) =>
        app.get(JwtService, { strict: false }).decode<{ exp: number }>(token)
          .exp;
      expect(expiry(switched.body.accessToken)).toBeLessThanOrEqual(
        expiry(tokenA),
      );

      const log = await prisma.auditLog.findMany({
        where: { action: 'ORGANISATION_SWITCHED', actorId: both.id },
      });
      expect(log).toEqual([
        expect.objectContaining({
          organisationId: b.id,
          entityId: inB.id,
          metadata: null,
        }),
      ]);
    });

    it('refuses a membership that is not the caller’s own and active', async () => {
      const [a, b] = [await workspace('a'), await workspace('b')];
      const [caller, other] = [await person(), await person()];
      const mine = await addMember(caller, a);
      const theirs = await addMember(other, b);
      const disabled = await addMember(caller, b);
      await prisma.organisationMembership.update({
        where: { id: disabled.id },
        data: { status: 'DISABLED' },
      });
      const token = await tokenFor(caller, mine.id);
      for (const membershipId of [theirs.id, disabled.id, randomUUID()]) {
        await as(token)
          .post('/auth/organisations/switch', {
            membershipId,
            backupCode: caller.codes[0],
          })
          .expect(404);
      }
    });

    it('will not open a team workspace for an account without two-factor', async () => {
      const [a, b] = [await workspace('a'), await workspace('b')];
      const who = await person(false);
      const customer = await prisma.customer.create({
        data: { organisationId: a.id, firstName: 'Pat', lastName: 'Example' },
      });
      const portal = await prisma.organisationMembership.create({
        data: {
          organisationId: a.id,
          userId: who.id,
          role: 'CUSTOMER',
          customerId: customer.id,
          status: 'ACTIVE',
        },
      });
      const team = await addMember(who, b);
      const response = await as(await tokenFor(who, portal.id))
        .post('/auth/organisations/switch', { membershipId: team.id })
        .expect(400);
      expect(response.body.code).toBe('switch_two_factor_setup_required');
    });

    it('refuses a session that names no workspace', async () => {
      const who = await person();
      await addMember(who, await workspace('a'));
      await as(await tokenFor(who))
        .get('/auth/me')
        .expect(401);
    });
  });

  describe('plan rules', () => {
    async function lapsed(readOnlyFrom: Date | null, status = 'PAST_DUE') {
      const org = await workspace('plan');
      await prisma.subscription.update({
        where: { organisationId: org.id },
        data: { status: status as 'PAST_DUE', readOnlyFrom },
      });
      const who = await person();
      const membership = await addMember(who, org);
      return { org, who, token: await tokenFor(who, membership.id) };
    }
    const customer = { firstName: 'New', lastName: 'Customer' };
    const past = () => new Date(Date.now() - HOUR);

    it('sets no restriction until a date is set and has passed', async () => {
      for (const [from, status] of [
        [null, 'CANCELLED'],
        [new Date(Date.now() + HOUR), 'PAST_DUE'],
        [past(), 'ACTIVE'],
      ] as const) {
        const { token } = await lapsed(from, status);
        await as(token).post('/customers', customer).expect(201);
      }
    });

    it('makes a lapsed workspace read-only without blocking reading or sign-in changes', async () => {
      const { token, who } = await lapsed(past());
      const refused = await as(token).post('/customers', customer).expect(403);
      expect(refused.body.code).toBe('workspace_read_only');
      await as(token).get('/customers').expect(200);
      await as(token).patch('/auth/me', { name: 'Still Me' }).expect(200);
      const second = await addMember(who, await workspace('other'));
      const moved = await as(token)
        .post('/auth/organisations/switch', {
          membershipId: second.id,
          backupCode: who.codes[0],
        })
        .expect(201);
      await as(moved.body.accessToken).post('/customers', customer).expect(201);
    });

    it('has no limit now, and enforces one once it is defined', async () => {
      const { org, token } = await lapsed(null, 'ACTIVE');
      const created = await as(token).post('/customers', customer).expect(201);
      const job = () =>
        as(token).post('/import-jobs', {
          customerId: created.body.id,
          make: 'Test',
        });
      const invite = () =>
        as(token).post('/organisation/members/invite', {
          email: `${randomUUID()}@example.test`,
          name: 'New Person',
          role: 'STAFF',
        });
      await prisma.route.deleteMany({ where: { organisationId: org.id } });
      await app
        .get(WorkflowRoutesService, { strict: false })
        .ensureDefault(org.id);
      await job().expect(201);

      const usage = app.get(UsageService, { strict: false });
      usage.planLimits = {
        ...PLAN_LIMITS,
        STARTER: { importJobsPerMonth: 1, activeStaff: null },
      };
      try {
        const over = await job().expect(403);
        expect(over.body.code).toBe('plan_limit_reached');
      } finally {
        usage.planLimits = PLAN_LIMITS;
      }
      // The refused job left neither a job nor a count behind.
      expect(
        await prisma.importJob.count({ where: { organisationId: org.id } }),
      ).toBe(1);
      expect(
        await prisma.usageRecord.aggregate({
          where: { organisationId: org.id },
          _sum: { quantity: true },
        }),
      ).toEqual({ _sum: { quantity: 1 } });
      await invite().expect(201);
    });
  });
});
