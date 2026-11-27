/**
 * Input checks over real HTTP: the whole app, as main.ts sets it up, against a
 * real PostgreSQL database. Skipped unless TEST_DATABASE_URL names a scratch
 * database that already has the schema:
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
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { PrismaService } from './prisma/prisma.service';
import { UsageService } from './tenancy/usage.service';
import { GpsIndexesService } from './tracking/gps-indexes.service';
import { GpsRetentionService } from './tracking/gps-retention.service';
import { WorkflowRoutesService } from './workflow/workflow-routes.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;

describeWithDatabase('input checks over HTTP', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token: string;
  let uploads: string;
  let organisationId: string;
  let customerId: string;
  let jobId: string;
  const env = { ...process.env };

  beforeAll(async () => {
    uploads = await mkdtemp(join(tmpdir(), 'harbour-validation-'));
    Object.assign(process.env, {
      DATABASE_URL: url,
      JWT_SECRET: randomUUID() + randomUUID(),
      TWO_FACTOR_ENCRYPTION_KEY: randomUUID() + randomUUID(),
      STORAGE_LOCAL_DIR: uploads,
      EMAIL_PROVIDER: 'log',
      AI_PROVIDER: 'log',
    });
    // The start-up jobs go through every workspace, including the ones other
    // database specs are using at the same time.
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

    organisationId = randomUUID();
    await prisma.organisation.create({
      data: { id: organisationId, name: 'Checks', slug: organisationId },
    });
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        name: 'Admin',
        passwordHash: 'x',
        twoFactorEnabled: true,
      },
    });
    const membership = await prisma.organisationMembership.create({
      data: {
        organisationId,
        userId: user.id,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    token = await app
      .get(JwtService, { strict: false })
      .signAsync({ sub: user.id, membershipId: membership.id });
  });

  afterAll(async () => {
    await app?.close();
    await rm(uploads, { recursive: true, force: true });
    process.env = env;
    jest.restoreAllMocks();
  });

  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(app.getHttpServer())
      [method](`/api${path}`)
      .set('Authorization', `Bearer ${token}`);

  const refused = async (
    method: 'post' | 'patch',
    path: string,
    body: object,
    field: string,
  ) => {
    const response = await call(method, path).send(body);
    expect([response.status, response.body]).toEqual([
      400,
      expect.objectContaining({
        message: expect.arrayContaining([expect.stringContaining(field)]),
      }),
    ]);
  };

  it('takes a new customer as the web app sends it, with spaces trimmed', async () => {
    const response = await call('post', '/customers')
      .send({
        firstName: 'Anna',
        lastName: 'Example',
        email: ' anna@example.test ',
      })
      .expect(201);
    customerId = response.body.id;
    expect(response.body.email).toBe('anna@example.test');
  });

  it('refuses text that is too long and null for a required name', async () => {
    const long = 'x'.repeat(101);
    await refused(
      'post',
      '/customers',
      { firstName: long, lastName: 'B' },
      'firstName',
    );
    await refused(
      'patch',
      `/customers/${customerId}`,
      { lastName: null },
      'lastName',
    );
    await refused(
      'patch',
      `/customers/${customerId}`,
      { notes: 'x'.repeat(5001) },
      'notes',
    );
    await call('patch', `/customers/${customerId}`)
      .send({
        firstName: 'Anna',
        lastName: 'Example',
        phone: '',
        address: '',
        notes: '',
      })
      .expect(200);
  });

  it('no longer turns a number into text', async () => {
    await refused(
      'post',
      '/customers',
      { firstName: 12, lastName: 'B' },
      'firstName',
    );
  });

  it('takes a new job as the web app sends it, with an empty vehicle lookup', async () => {
    const route = await app
      .get(WorkflowRoutesService)
      .ensureDefault(organisationId);
    const response = await call('post', '/import-jobs')
      .send({
        customerId,
        routeId: route.id,
        ukRegistration: 'AB12 CDE',
        vin: null,
        make: null,
        model: null,
        variant: null,
        year: null,
        colour: null,
        fuelType: null,
        engineSize: null,
        bodyType: null,
        mileage: null,
        countryOfRegistration: 'GB',
        originCountry: 'GB',
        destinationCountry: 'CY',
        registrationCountry: 'BG',
        expectedDeliveryDate: '2026-12-31',
      })
      .expect(201);
    jobId = response.body.id;
    expect(response.body.vehicle.year).toBeNull();
  });

  it.each([
    [{ year: '2019' }, 'year'],
    [{ year: 1700 }, 'year'],
    [{ mileage: -1 }, 'mileage'],
    [{ mileage: 1.5 }, 'mileage'],
    [{ originCountry: 'Britain' }, 'originCountry'],
    [{ expectedDeliveryDate: '2026-02-31' }, 'expectedDeliveryDate'],
    [{ expectedDeliveryDate: '2026-W05' }, 'expectedDeliveryDate'],
  ])('refuses a new job with %j', async (bad, field) => {
    await refused('post', '/import-jobs', { customerId, ...bad }, field);
  });

  it('wants an amount that is a number within range', async () => {
    const path = `/import-jobs/${jobId}/costs`;
    for (const amount of ['12', '', null, true, -1, 2_000_000_000]) {
      await refused('post', path, { category: 'TRANSPORT', amount }, 'amount');
    }
    await refused(
      'post',
      path,
      { category: 'TRANSPORT', amount: 1, currency: 'EURO' },
      'currency',
    );
    await call('post', path)
      .send({ category: 'TRANSPORT', amount: 12.5 })
      .expect(201);
  });

  it('checks task dates, and lets a date be cleared', async () => {
    const path = `/import-jobs/${jobId}/tasks`;
    await refused(
      'post',
      path,
      { title: 'Ring', dueDate: 'tomorrow' },
      'dueDate',
    );
    const task = await call('post', path)
      .send({ title: 'Ring', priority: 'HIGH', dueDate: '2026-12-01' })
      .expect(201);
    await refused('patch', `${path}/${task.body.id}`, { title: null }, 'title');
    const cleared = await call('patch', `${path}/${task.body.id}`)
      .send({ title: 'Ring', priority: 'LOW', dueDate: null })
      .expect(200);
    expect(cleared.body.dueDate).toBeNull();
  });

  it('reads an upload’s "false" as false, and refuses "false" in JSON', async () => {
    const upload = (customerVisible: string) =>
      call('post', `/import-jobs/${jobId}/documents`)
        .field('type', 'OTHER')
        .field('customerVisible', customerVisible)
        .attach('file', Buffer.from('%PDF-1.4\n%%EOF\n'), {
          filename: 'a.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
    await upload('false');
    await upload('true');
    const documents = await prisma.document.findMany({
      where: { importJobId: jobId },
      orderBy: { createdAt: 'asc' },
    });
    expect(documents.map((d) => d.customerVisible)).toEqual([false, true]);

    // Before, the text "false" became true and shared the file.
    const path = `/import-jobs/${jobId}/documents/${documents[0].id}`;
    await refused(
      'patch',
      path,
      { customerVisible: 'false' },
      'customerVisible',
    );
    const after = await prisma.document.findUniqueOrThrow({
      where: { id: documents[0].id },
    });
    expect(after.customerVisible).toBe(false);
    await call('patch', path).send({ customerVisible: true }).expect(200);
  });

  it('checks a typed-in position', async () => {
    const tracker = await prisma.tracker.create({
      data: { organisationId, serialNumber: randomUUID(), provider: 'manual' },
    });
    const path = `/trackers/${tracker.id}/locations`;
    const here = { latitude: 35.1, longitude: 33.4 };
    for (const [bad, field] of [
      [{ latitude: 91 }, 'latitude'],
      [{ latitude: '35.1' }, 'latitude'],
      [{ longitude: -181 }, 'longitude'],
      [{ speed: -5 }, 'speed'],
      [{ heading: 361 }, 'heading'],
      [{ accuracy: 10_000_000 }, 'accuracy'],
      [{ recordedAt: '2099-01-01T00:00:00Z' }, 'recordedAt'],
      [{ recordedAt: '2026-01-01T99:00:00Z' }, 'recordedAt'],
    ] as const) {
      await refused('post', path, { ...here, ...bad }, field);
    }
    await call('post', path)
      .send({ ...here, speed: 40, recordedAt: '2026-01-01T10:00:00.000Z' })
      .expect(201);
  });

  it('takes the workspace settings as the web app sends them', async () => {
    const settings = {
      name: 'Checks',
      legalName: '',
      brandName: 'Checks',
      timezone: 'Europe/Nicosia',
      currency: 'EUR',
      country: 'CY',
    };
    await call('patch', '/organisation').send(settings).expect(200);
    for (const [bad, field] of [
      [{ timezone: 'Mars/Olympus' }, 'timezone'],
      [{ currency: 'E1' }, 'currency'],
      [{ country: 'Cyprus' }, 'country'],
      [{ brandName: null }, 'brandName'],
    ] as const) {
      await refused('patch', '/organisation', { ...settings, ...bad }, field);
    }
  });

  it('checks route switches, stage bodies and the query that moves jobs', async () => {
    const created = await call('post', '/routes')
      .send({
        name: 'Japan to Cyprus',
        shortLabel: 'JP → CY',
        originCountry: 'JP',
        destinationCountry: 'CY',
      })
      .expect(201);
    const path = `/routes/${created.body.id}`;
    await refused('patch', path, { active: 'false' }, 'active');
    const stage = {
      name: 'Sailing',
      customerName: 'Sailing',
      customerVisible: false,
      statuses: [{ label: 'At sea' }],
    };
    await refused(
      'post',
      `${path}/stages`,
      { ...stage, customerVisible: 'false' },
      'customerVisible',
    );
    await refused(
      'post',
      `${path}/stages`,
      { ...stage, statuses: [{ label: 7 }] },
      'label',
    );
    const saved = await call('post', `${path}/stages`).send(stage).expect(201);
    expect(saved.body.stages[0].customerVisible).toBe(false);
    const stagePath = `${path}/stages/${saved.body.stages[0].id}`;
    await call('delete', `${stagePath}?moveTo=A&moveTo=B`).expect(400);
    await call('delete', `${stagePath}?moveTo=NEW`).expect(200);
  });

  it('still reads search and status from the query', async () => {
    const found = await call('get', '/customers?search=Anna').expect(200);
    expect(JSON.stringify(found.body)).toContain(customerId);
    await call('get', '/import-jobs?status=NEW&search=AB12').expect(200);
  });
});
