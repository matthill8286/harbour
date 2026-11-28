/**
 * Accepting the agreements over real HTTP, against a real PostgreSQL database.
 * Skipped unless TEST_DATABASE_URL names a scratch database that already has
 * the schema:
 *
 *   DATABASE_URL=<scratch url> pnpm run db:deploy
 *   TEST_DATABASE_URL=<scratch url> pnpm exec jest db.spec
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { currentLegalVersions, LEGAL_DOCUMENTS } from '@vip/shared';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../tenancy/usage.service';
import { GpsIndexesService } from '../tracking/gps-indexes.service';
import { GpsRetentionService } from '../tracking/gps-retention.service';
import { WorkflowRoutesService } from '../workflow/workflow-routes.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;
const SLOW = 60_000;

describeWithDatabase('accepting the agreements', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const env = { ...process.env };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      JWT_SECRET: randomUUID() + randomUUID(),
      TWO_FACTOR_ENCRYPTION_KEY: randomUUID() + randomUUID(),
      EMAIL_PROVIDER: 'log',
      AI_PROVIDER: 'log',
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
  }, SLOW);

  afterAll(async () => {
    await app?.close();
    process.env = env;
    jest.restoreAllMocks();
  });

  /** A workspace with an Admin and a Staff member, both with two-factor on. */
  async function workspace(subscription: object = {}) {
    const slug = `terms-${randomUUID()}`;
    const organisation = await prisma.organisation.create({
      data: { name: slug, slug, subscription: { create: subscription } },
    });
    const member = async (role: 'ADMIN' | 'STAFF') => {
      const user = await prisma.user.create({
        data: {
          email: `${randomUUID()}@example.test`,
          name: `${role} person`,
          twoFactorEnabled: true,
        },
      });
      const membership = await prisma.organisationMembership.create({
        data: {
          organisationId: organisation.id,
          userId: user.id,
          role,
          status: 'ACTIVE',
        },
      });
      const token = await app
        .get(JwtService, { strict: false })
        .signAsync({ sub: user.id, membershipId: membership.id });
      return { user, token };
    };
    return {
      id: organisation.id,
      admin: await member('ADMIN'),
      staff: await member('STAFF'),
    };
  }

  const get = (token: string, path: string) =>
    request(app.getHttpServer())
      .get(`/api${path}`)
      .set('Authorization', `Bearer ${token}`);
  const post = (token: string, path: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('asks for every document until an Admin accepts, and records who and when', async () => {
    const ws = await workspace();
    const before = await get(ws.staff.token, '/organisation/terms').expect(200);
    expect(before.body.outstanding).toEqual(
      LEGAL_DOCUMENTS.map((item) => item.key),
    );
    expect(before.body.subProcessors.length).toBeGreaterThan(0);

    await post(ws.staff.token, '/organisation/terms/accept', {
      versions: currentLegalVersions(),
    }).expect(403);

    const after = await post(ws.admin.token, '/organisation/terms/accept', {
      versions: currentLegalVersions(),
    }).expect(200);
    expect(after.body.outstanding).toEqual([]);
    expect(after.body.documents[0].accepted).toMatchObject({
      current: true,
      acceptedBy: 'ADMIN person',
    });

    const rows = await prisma.termsAcceptance.findMany({
      where: { organisationId: ws.id },
    });
    expect(rows).toHaveLength(LEGAL_DOCUMENTS.length);
    expect(rows[0]).toMatchObject({
      acceptedById: ws.admin.user.id,
      acceptedByEmail: ws.admin.user.email,
    });
    const audits = await prisma.auditLog.findMany({
      where: { organisationId: ws.id, action: 'TERMS_ACCEPTED' },
    });
    expect(audits).toHaveLength(LEGAL_DOCUMENTS.length);

    // Accepting again changes nothing, and the Staff member sees no names.
    await post(ws.admin.token, '/organisation/terms/accept', {
      versions: currentLegalVersions(),
    }).expect(200);
    expect(
      await prisma.termsAcceptance.count({ where: { organisationId: ws.id } }),
    ).toBe(LEGAL_DOCUMENTS.length);
    const staffView = await get(ws.staff.token, '/organisation/terms');
    expect(staffView.body.documents[0].accepted.acceptedBy).toBeNull();
  });

  it('asks again when a version changes, and refuses an old version', async () => {
    const ws = await workspace();
    const old = LEGAL_DOCUMENTS[0];
    await prisma.termsAcceptance.createMany({
      data: LEGAL_DOCUMENTS.map((item) => ({
        organisationId: ws.id,
        document: item.key,
        version: item.key === old.key ? 'an-older-version' : item.version,
        subProcessorsVersion: 'an-older-list',
        acceptedById: ws.admin.user.id,
        acceptedByName: 'ADMIN person',
        acceptedByEmail: ws.admin.user.email,
      })),
    });
    const status = await get(ws.admin.token, '/organisation/terms');
    expect(status.body.outstanding).toEqual([old.key]);
    expect(status.body.documents[0].accepted).toMatchObject({
      version: 'an-older-version',
      current: false,
    });

    const refused = await post(ws.admin.token, '/organisation/terms/accept', {
      versions: { ...currentLegalVersions(), [old.key]: 'an-older-version' },
    }).expect(400);
    expect(refused.body.code).toBe('terms_changed');

    await post(ws.admin.token, '/organisation/terms/accept', {
      versions: currentLegalVersions(),
    }).expect(200);
    const audits = await prisma.auditLog.findMany({
      where: { organisationId: ws.id, action: 'TERMS_ACCEPTED' },
    });
    expect(audits.map((item) => item.metadata)).toEqual([
      expect.objectContaining({ document: old.key, version: old.version }),
    ]);
  });

  it('lets an Admin accept while the plan has made the workspace read-only', async () => {
    const ws = await workspace({
      status: 'CANCELLED',
      readOnlyFrom: new Date(Date.now() - 60_000),
    });
    await post(ws.admin.token, '/organisation/terms/accept', {
      versions: currentLegalVersions(),
    }).expect(200);
  });
});
