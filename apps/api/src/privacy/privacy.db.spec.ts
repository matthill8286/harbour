/**
 * Customer export, erasure and re-applying erasures over real HTTP, with two
 * workspaces and real files, against a real PostgreSQL database. Skipped unless
 * TEST_DATABASE_URL names a scratch database that already has the schema:
 *
 *   DATABASE_URL=<scratch url> pnpm exec prisma db push --skip-generate
 *   TEST_DATABASE_URL=<scratch url> pnpm exec jest db.spec
 */
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hash } from 'argon2';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { SecretBox } from '../auth/two-factor/secret-box';
import {
  generateBackupCodes,
  generateTotpSecret,
  normaliseBackupCode,
} from '../auth/two-factor/totp';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../tenancy/usage.service';
import { GpsIndexesService } from '../tracking/gps-indexes.service';
import { GpsRetentionService } from '../tracking/gps-retention.service';
import { WorkflowRoutesService } from '../workflow/workflow-routes.service';
import { CustomerErasureService } from './customer-erasure.service';
import { ErasureJournal } from './erasure-journal';
import { reapplyErasures } from './reapply-erasures';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;
const PASSWORD = 'correct horse battery';
/** Starting the app and making pictures can be slow on a busy machine. */
const SLOW = 60_000;

/** The names and contents of a ZIP, read from its directory. */
function unzip(archive: Buffer): Map<string, Buffer> {
  const end = archive.lastIndexOf(Buffer.from('504b0506', 'hex'));
  const entries = new Map<string, Buffer>();
  let at = archive.readUInt32LE(end + 16);
  for (let left = archive.readUInt16LE(end + 10); left > 0; left -= 1) {
    const method = archive.readUInt16LE(at + 10);
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength);
    const start =
      local +
      30 +
      archive.readUInt16LE(local + 26) +
      archive.readUInt16LE(local + 28);
    const body = archive.subarray(start, start + size);
    entries.set(name, method === 8 ? inflateRawSync(body) : body);
    at +=
      46 +
      nameLength +
      archive.readUInt16LE(at + 30) +
      archive.readUInt16LE(at + 32);
  }
  return entries;
}

describeWithDatabase('customer export and erasure', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let uploads: string;
  let secretKey: string;
  let passwordHash: string;
  let picture: Buffer;
  const env = { ...process.env };

  beforeAll(async () => {
    uploads = await mkdtemp(join(tmpdir(), 'harbour-privacy-'));
    secretKey = randomUUID() + randomUUID();
    Object.assign(process.env, {
      DATABASE_URL: url,
      JWT_SECRET: randomUUID() + randomUUID(),
      TWO_FACTOR_ENCRYPTION_KEY: secretKey,
      STORAGE_LOCAL_DIR: uploads,
      STORAGE_MIN_FREE_MB: '1',
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
    passwordHash = await hash(PASSWORD);
    picture = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#336699' },
    })
      .jpeg()
      .toBuffer();
  }, SLOW);

  afterAll(async () => {
    await app?.close();
    await rm(uploads, { recursive: true, force: true });
    process.env = env;
    jest.restoreAllMocks();
  });

  const tag = () => randomUUID().slice(0, 8);

  async function account(data: Record<string, unknown> = {}) {
    return prisma.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        name: 'Someone',
        passwordHash,
        ...data,
      },
    });
  }

  /** A workspace with an Admin and a Staff member, both with two-factor on. */
  async function workspace() {
    const slug = `privacy-${randomUUID()}`;
    const organisation = await prisma.organisation.create({
      data: { name: slug, slug, subscription: { create: {} } },
    });
    const member = async (role: 'ADMIN' | 'STAFF') => {
      const codes = generateBackupCodes();
      const box = new SecretBox(secretKey);
      const user = await account({
        name: `${role} person`,
        twoFactorEnabled: true,
        twoFactor: {
          create: {
            secret: box.encrypt(generateTotpSecret()),
            backupCodes: box.encrypt(
              JSON.stringify(codes.map(normaliseBackupCode)),
            ),
            verified: true,
          },
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
      let used = 0;
      return {
        user,
        token,
        proof: () => ({ password: PASSWORD, backupCode: codes[used++] }),
      };
    };
    return {
      id: organisation.id,
      admin: await member('ADMIN'),
      staff: await member('STAFF'),
    };
  }
  type Workspace = Awaited<ReturnType<typeof workspace>>;

  const as = (token: string) => {
    const send = (method: 'get' | 'post' | 'patch', path: string) =>
      request(app.getHttpServer())
        [method](`/api${path}`)
        .set('Authorization', `Bearer ${token}`);
    return {
      get: (path: string) => send('get', path),
      post: (path: string, body: object = {}) => send('post', path).send(body),
      patch: (path: string, body: object) => send('patch', path).send(body),
      upload: (path: string, field: string, value: string, name: string) =>
        send('post', path)
          .field(field, value)
          .attach(
            'file',
            name.endsWith('.pdf')
              ? Buffer.from(`%PDF-1.4\n${name}\n%%EOF`)
              : picture,
            name,
          ),
    };
  };

  const binary = (test: request.Test) =>
    test.buffer(true).parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done(null, Buffer.concat(chunks)));
    });

  async function filesUnder(organisationId: string) {
    const entries = await readdir(join(uploads, organisationId), {
      recursive: true,
      withFileTypes: true,
    }).catch(() => []);
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  }

  /** Every row of every table that mentions any of these, as text. */
  async function rowsMentioning(words: string[]) {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name::text FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    const found: string[] = [];
    for (const { table_name } of tables) {
      for (const word of words) {
        const rows = await prisma.$queryRawUnsafe<{ row: string }[]>(
          `SELECT t::text AS row FROM "${table_name}" t WHERE t::text ILIKE $1`,
          `%${word}%`,
        );
        found.push(...rows.map(({ row }) => `${table_name}: ${row}`));
      }
    }
    return found;
  }

  /** A customer with a closed job full of personal data and files. */
  async function customerWithHistory(
    w: Workspace,
    { portalUserId }: { portalUserId?: string } = {},
  ) {
    const id = tag();
    // Words that appear nowhere else, so the database can be searched for them.
    const person = {
      firstName: `Zed${id}`,
      lastName: `Quill${id}`,
      email: `zed.${id}@private.test`,
      phone: `+357 99 ${parseInt(id.slice(0, 6), 16)}`,
      address: `${id} Hidden Street`,
      notes: `Gate code for ${id}`,
    };
    const admin = as(w.admin.token);
    const created = await admin.post('/customers', person).expect(201);
    const customerId: string = created.body.id;
    const portalUser = portalUserId
      ? await prisma.user.findUniqueOrThrow({ where: { id: portalUserId } })
      : await account({ email: person.email, name: `Zed${id} Quill${id}` });
    const membership = await prisma.organisationMembership.create({
      data: {
        organisationId: w.id,
        userId: portalUser.id,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        customerId,
        acceptedAt: new Date(),
      },
    });
    await prisma.portalInvite.create({
      data: {
        organisationId: w.id,
        customerId,
        userId: portalUser.id,
        createdById: w.admin.user.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: { organisationId: w.id, vin: `VIN${id}` },
    });
    const job = await prisma.importJob.create({
      data: {
        organisationId: w.id,
        customerId,
        vehicleId: vehicle.id,
        reference: `REF-${id}`,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
    const files: Record<string, string> = {};
    for (const [kind, label] of [
      ['documents', 'PURCHASE_INVOICE'],
      ['documents', 'CUSTOMER'],
      ['documents', 'V5C'],
      ['photos', 'COLLECTION'],
      ['photos', 'DAMAGE'],
    ] as const) {
      const response = await admin
        .upload(
          `/import-jobs/${job.id}/${kind}`,
          kind === 'documents' ? 'type' : 'category',
          label,
          `Zed${id} ${label}.${kind === 'documents' ? 'pdf' : 'jpg'}`,
        )
        .field('customerVisible', 'true')
        .expect(201);
      files[label] = response.body.id;
    }
    // Left behind by an upload that failed.
    const orphan = `${w.id}/jobs/${job.id}/documents/${randomUUID()}.pdf`;
    await writeFile(join(uploads, orphan), 'left over');
    const base = { organisationId: w.id, importJobId: job.id };
    const task = await prisma.task.create({
      data: { ...base, title: `Ring Zed${id}`, description: person.phone },
    });
    for (const where of [
      { importJobId: job.id },
      { customerId },
      { taskId: task.id },
      { vehicleId: vehicle.id },
    ]) {
      await prisma.note.create({
        data: {
          organisationId: w.id,
          authorId: w.staff.user.id,
          body: `About Quill${id}`,
          ...where,
        },
      });
    }
    await prisma.journey.create({
      data: { ...base, origin: 'Dover', destination: person.address },
    });
    await prisma.jobStatusHistory.create({
      data: { ...base, toStatus: 'COMPLETED', note: `Zed${id} collected it` },
    });
    await prisma.locationEvent.create({
      data: {
        ...base,
        vehicleId: vehicle.id,
        latitude: 34.7,
        longitude: 33.1,
        recordedAt: new Date(),
      },
    });
    const cost = await prisma.cost.create({
      data: {
        ...base,
        category: 'TRANSPORT',
        description: `Delivery to Quill${id}`,
        amount: 120,
        invoiceReference: 'INV-7',
      },
    });
    await prisma.customerCharge.create({
      data: {
        ...base,
        category: 'IMPORT_SERVICE',
        description: 'Import service',
        amount: 900,
      },
    });
    await prisma.auditLog.create({
      data: {
        organisationId: w.id,
        actorId: w.admin.user.id,
        action: 'CUSTOMER_INVITED',
        entityType: 'Customer',
        entityId: customerId,
        metadata: { customerId, email: person.email },
      },
    });
    await prisma.auditLog.create({
      data: {
        organisationId: w.id,
        actorId: portalUser.id,
        action: 'CUSTOMER_UPDATED_OWN_DETAILS',
        entityType: 'Customer',
        entityId: customerId,
      },
    });
    return {
      id,
      person,
      customerId,
      jobId: job.id,
      costId: cost.id,
      files,
      orphan,
      portalUser,
      membershipId: membership.id,
      words: [`Zed${id}`, `Quill${id}`, person.email, person.phone],
    };
  }

  const counts = (w: Workspace) => {
    const where = { organisationId: w.id };
    return Promise.all([
      prisma.customer.count({ where }),
      prisma.note.count({ where }),
      prisma.document.count({ where }),
      prisma.photo.count({ where }),
      prisma.locationEvent.count({ where }),
      prisma.organisationMembership.count({ where }),
      prisma.auditLog.count({
        where: { ...where, metadata: { path: ['email'], not: 'null' } },
      }),
    ]);
  };

  type Preview = {
    confirmation: string;
    openJobs: object[];
    remove: object;
    anonymise: object;
    keep: object;
    review: { kind: string }[];
  };

  const preview = async (w: Workspace, customerId: string) =>
    (
      await as(w.admin.token)
        .get(`/customers/${customerId}/erasure/preview`)
        .expect(200)
    ).body as Preview;

  const erase = async (w: Workspace, customerId: string) => {
    const { confirmation } = await preview(w, customerId);
    return as(w.admin.token).post(`/customers/${customerId}/erasure`, {
      confirmation,
      ...w.admin.proof(),
    });
  };

  it(
    'lets only an Admin of the same workspace export, preview or erase',
    async () => {
      const [a, b] = [await workspace(), await workspace()];
      const c = await customerWithHistory(a);
      for (const path of ['export', 'erasure/preview', 'erasure']) {
        await as(a.staff.token)
          .get(`/customers/${c.customerId}/${path}`)
          .expect(403);
      }
      await as(b.admin.token)
        .get(`/customers/${c.customerId}/export`)
        .expect(404);
      await as(b.admin.token)
        .get(`/customers/${c.customerId}/erasure/preview`)
        .expect(404);
      const body = {
        confirmation: (await preview(a, c.customerId)).confirmation,
      };
      await as(a.staff.token)
        .post(`/customers/${c.customerId}/erasure`, {
          ...body,
          ...a.staff.proof(),
        })
        .expect(403);
      await as(b.admin.token)
        .post(`/customers/${c.customerId}/erasure`, {
          ...body,
          ...b.admin.proof(),
        })
        .expect(404);
    },
    SLOW,
  );

  it(
    'exports that customer’s data and files, without staff or other customers',
    async () => {
      const a = await workspace();
      const c = await customerWithHistory(a);
      const other = await customerWithHistory(a);
      const response = await binary(
        as(a.admin.token).get(`/customers/${c.customerId}/export`),
      ).expect(200);
      expect(response.headers['content-type']).toBe('application/zip');
      const entries = unzip(response.body as Buffer);
      const text = entries.get('data.json')!.toString('utf8');
      const data = JSON.parse(text);
      expect(data.customer).toMatchObject({
        email: c.person.email,
        address: c.person.address,
        notes: c.person.notes,
      });
      expect(data.jobs).toHaveLength(1);
      expect(data.jobs[0]).toMatchObject({
        vehicle: { vin: `VIN${c.id}` },
        positions: [expect.anything()],
        costsNamingCustomer: [expect.anything()],
      });
      expect(data.missingFiles).toEqual([]);
      const listed = [...data.jobs[0].documents, ...data.jobs[0].photos].map(
        (file: { file: string }) => file.file,
      );
      expect(listed).toHaveLength(5);
      for (const path of listed) {
        expect(entries.get(path)!.length).toBeGreaterThan(0);
      }
      expect(entries.size).toBe(6);
      expect(data.customer.memberships[0].user).toEqual({
        email: c.person.email,
      });
      expect(text).not.toContain(a.staff.user.email);
      expect(text).not.toContain('person"');
      expect(text).not.toContain(a.id);
      expect(text).not.toContain(other.id);
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { organisationId: a.id, action: 'CUSTOMER_DATA_EXPORTED' },
      });
      expect(log.metadata).toEqual({ customerId: c.customerId, files: 5 });
    },
    SLOW,
  );

  it(
    'is blocked while a job is open, and by a wrong password, code or old preview',
    async () => {
      const a = await workspace();
      const c = await customerWithHistory(a);
      const post = (body: object) =>
        as(a.admin.token).post(`/customers/${c.customerId}/erasure`, body);
      await prisma.importJob.update({
        where: { id: c.jobId },
        data: { status: 'COLLECTED' },
      });
      const open = await preview(a, c.customerId);
      expect(open.openJobs).toEqual([
        { id: c.jobId, reference: `REF-${c.id}`, status: 'COLLECTED' },
      ]);
      const blocked = await post({
        confirmation: open.confirmation,
        ...a.admin.proof(),
      }).expect(409);
      expect(blocked.body.message).toContain(`REF-${c.id}`);
      await prisma.importJob.update({
        where: { id: c.jobId },
        data: { status: 'CANCELLED' },
      });
      const { confirmation } = await preview(a, c.customerId);
      await post({ confirmation }).expect(400);
      await post({
        confirmation,
        ...a.admin.proof(),
        password: 'wrong password',
      }).expect(400);
      await post({
        confirmation,
        password: PASSWORD,
        backupCode: 'not-a-code',
      }).expect(400);
      await post({ confirmation, password: PASSWORD }).expect(400);
      await prisma.note.create({
        data: {
          organisationId: a.id,
          customerId: c.customerId,
          authorId: a.staff.user.id,
          body: 'Added after the preview',
        },
      });
      const stale = await post({ confirmation, ...a.admin.proof() }).expect(
        400,
      );
      expect(stale.body.code).toBe('erasure_preview_changed');
      expect(
        await prisma.customer.findUniqueOrThrow({
          where: { id: c.customerId },
        }),
      ).toMatchObject({ email: c.person.email, erasedAt: null });
    },
    SLOW,
  );

  it(
    'erases what the preview showed, keeps and flags the rest, and leaves the other workspace alone',
    async () => {
      const [a, b] = [await workspace(), await workspace()];
      const c = await customerWithHistory(a);
      const theirs = await customerWithHistory(b);
      const other = await counts(b);
      const otherFiles = (await filesUnder(b.id)).sort();
      // Copies made on request must go too.
      await as(a.admin.token)
        .get(`/import-jobs/${c.jobId}/photos/${c.files.COLLECTION}?size=thumb`)
        .expect(200);
      const keyOf = async (label: string) =>
        (
          (await prisma.document.findUnique({
            where: { id: c.files[label] },
          })) ??
          (await prisma.photo.findUniqueOrThrow({
            where: { id: c.files[label] },
          }))
        ).storageKey;
      const removedKeys = [
        await keyOf('CUSTOMER'),
        await keyOf('COLLECTION'),
        c.orphan,
      ];
      const keptKeys = [
        await keyOf('PURCHASE_INVOICE'),
        await keyOf('V5C'),
        await keyOf('DAMAGE'),
      ];

      const shown = await preview(a, c.customerId);
      expect(shown).toMatchObject({
        openJobs: [],
        remove: {
          notes: 4,
          gpsPoints: 1,
          documents: 1,
          photos: 1,
          portalAccess: 1,
        },
        keep: { jobs: 1, files: 1, costs: 1, charges: 1 },
      });
      expect(shown.review.map((item) => item.kind).sort()).toEqual([
        'COST',
        'DOCUMENT',
        'PHOTO',
      ]);
      // Nothing has changed yet.
      expect(await rowsMentioning([c.person.address])).not.toEqual([]);

      const response = await erase(a, c.customerId);
      expect([response.status, response.body.filesNotRemoved]).toEqual([
        200, 0,
      ]);

      const names = await filesUnder(a.id);
      for (const key of removedKeys) {
        const stem = key.split('/').pop()!;
        expect(names.filter((name) => name.startsWith(stem))).toEqual([]);
      }
      for (const key of keptKeys) {
        expect(names).toContain(key.split('/').pop());
      }
      expect(
        await prisma.customer.findUniqueOrThrow({
          where: { id: c.customerId },
        }),
      ).toMatchObject({
        firstName: 'Erased',
        lastName: 'customer',
        email: null,
        phone: null,
        address: null,
        notes: null,
        erasedAt: expect.any(Date),
      });
      expect(
        await prisma.document.findUniqueOrThrow({
          where: { id: c.files.PURCHASE_INVOICE },
        }),
      ).toMatchObject({
        name: 'purchase_invoice.pdf',
        customerVisible: false,
      });
      expect(await prisma.importJob.count({ where: { id: c.jobId } })).toBe(1);
      expect(
        await prisma.user.findUnique({ where: { id: c.portalUser.id } }),
      ).toBeNull();

      // Only the flagged cost still names them, until an Admin decides.
      const left = await rowsMentioning([...c.words, c.person.address]);
      expect(left).toEqual([expect.stringContaining('Cost: ')]);

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { organisationId: a.id, action: 'CUSTOMER_ERASED' },
      });
      expect(entry.metadata).toEqual({
        customerId: c.customerId,
        jobsKept: 1,
        notesRemoved: 4,
        gpsPointsRemoved: 1,
        documentsRemoved: 1,
        photosRemoved: 1,
        filesRetained: 1,
        flaggedForReview: 3,
      });
      const journal = JSON.stringify(
        await app.get(ErasureJournal, { strict: false }).read(),
      );
      for (const word of [...c.words, c.person.address]) {
        expect(journal).not.toContain(word);
      }
      expect(await counts(b)).toEqual(other);
      expect((await filesUnder(b.id)).sort()).toEqual(otherFiles);
      expect(await rowsMentioning([theirs.person.email])).not.toEqual([]);

      // No second erasure, and no new data on the erased customer.
      await erase(a, c.customerId).then((again) =>
        expect(again.status).toBe(409),
      );
      await as(a.admin.token)
        .patch(`/customers/${c.customerId}`, { firstName: 'Back' })
        .expect(409);
      await as(a.admin.token)
        .post(`/customers/${c.customerId}/invite`)
        .expect(409);
      await as(a.admin.token)
        .post('/import-jobs', { customerId: c.customerId, make: 'Test' })
        .expect(409);

      // The review: removing needs both factors again.
      const status = (
        await as(a.admin.token)
          .get(`/customers/${c.customerId}/erasure`)
          .expect(200)
      ).body as { reviewItems: { id: string; kind: string }[] };
      const item = (kind: string) =>
        status.reviewItems.find((row) => row.kind === kind)!;
      const decide = (kind: string, body: object, token = a.admin.token) =>
        as(token).post(
          `/customers/${c.customerId}/erasure/review/${item(kind).id}`,
          body,
        );
      await decide('COST', { decision: 'REMOVE' }).expect(400);
      await decide('COST', { decision: 'KEEP' }, a.staff.token).expect(403);
      await decide('COST', { decision: 'KEEP' }, b.admin.token).expect(404);
      await decide('COST', {
        decision: 'REMOVE',
        ...a.admin.proof(),
      }).expect(200);
      await decide('PHOTO', {
        decision: 'REMOVE',
        ...a.admin.proof(),
      }).expect(200);
      await decide('DOCUMENT', { decision: 'KEEP' }).expect(200);
      await decide('DOCUMENT', { decision: 'KEEP' }).expect(409);
      expect(await rowsMentioning(c.words)).toEqual([]);
      expect(
        await prisma.cost.findUniqueOrThrow({ where: { id: c.costId } }),
      ).toMatchObject({ description: 'Removed', invoiceReference: 'INV-7' });
      expect(await filesUnder(a.id)).not.toContain(
        keptKeys[2].split('/').pop(),
      );
    },
    SLOW,
  );

  it(
    'never touches a sign-in account that another workspace uses',
    async () => {
      const [a, b] = [await workspace(), await workspace()];
      const shared = await account({ name: 'Shared Person' });
      const elsewhere = await prisma.organisationMembership.create({
        data: {
          organisationId: b.id,
          userId: shared.id,
          role: 'STAFF',
          status: 'DISABLED',
        },
      });
      const before = await prisma.user.findUniqueOrThrow({
        where: { id: shared.id },
      });
      const c = await customerWithHistory(a, { portalUserId: shared.id });
      const alone = await customerWithHistory(a);
      // The preview reads the same whether or not the account is used elsewhere.
      const shape = async (id: string) => {
        const { remove, anonymise, keep } = await preview(a, id);
        return { remove, anonymise, keep };
      };
      expect(await shape(c.customerId)).toEqual(await shape(alone.customerId));

      await erase(a, c.customerId).then((r) => expect(r.status).toBe(200));

      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: shared.id } }),
      ).toEqual(before);
      expect(
        await prisma.organisationMembership.findMany({
          where: { userId: shared.id },
          select: { id: true },
        }),
      ).toEqual([{ id: elsewhere.id }]);
    },
    SLOW,
  );

  it(
    'leaves a former portal user’s later team work alone',
    async () => {
      const a = await workspace();
      const c = await customerWithHistory(a);
      // Portal access moved away, and the person later joined the team.
      await prisma.organisationMembership.update({
        where: { id: c.membershipId },
        data: { role: 'STAFF', customerId: null },
      });
      const work = await prisma.auditLog.create({
        data: {
          organisationId: a.id,
          actorId: c.portalUser.id,
          action: 'ORGANISATION_UPDATED',
          entityType: 'Organisation',
          entityId: a.id,
          metadata: { fields: ['name'] },
        },
      });
      await erase(a, c.customerId).then((r) => expect(r.status).toBe(200));
      expect(
        await prisma.auditLog.findUniqueOrThrow({ where: { id: work.id } }),
      ).toEqual(work);
      expect(
        await prisma.user.findUnique({ where: { id: c.portalUser.id } }),
      ).toMatchObject({ email: c.person.email });
    },
    SLOW,
  );

  it(
    'works while a lapsed plan makes the workspace read-only',
    async () => {
      const a = await workspace();
      const c = await customerWithHistory(a);
      await prisma.subscription.update({
        where: { organisationId: a.id },
        data: { status: 'CANCELLED', readOnlyFrom: new Date(0) },
      });
      await binary(
        as(a.admin.token).get(`/customers/${c.customerId}/export`),
      ).expect(200);
      await erase(a, c.customerId).then((r) => expect(r.status).toBe(200));
    },
    SLOW,
  );

  it(
    'applies an erasure again after the data is restored, and only once',
    async () => {
      const a = await workspace();
      const c = await customerWithHistory(a);
      const photo = await prisma.photo.findUniqueOrThrow({
        where: { id: c.files.COLLECTION },
      });
      await erase(a, c.customerId).then((r) => expect(r.status).toBe(200));
      const journal = app.get(ErasureJournal, { strict: false });
      const mine = (await journal.read()).filter(
        (entry) => entry.customerId === c.customerId,
      );
      const erasures = app.get(CustomerErasureService, { strict: false });
      const run = async (confirm: boolean) =>
        (await reapplyErasures(prisma, erasures, mine, { confirm })).map(
          (result) => result.outcome,
        );
      expect(await run(true)).toEqual(['already']);

      // As a restore would leave it: the data back, and no record of erasing it.
      await prisma.customerErasure.deleteMany({
        where: { customerId: c.customerId },
      });
      await prisma.customer.update({
        where: { id: c.customerId },
        data: { ...c.person, erasedAt: null },
      });
      await prisma.photo.create({ data: photo });
      await mkdir(dirname(join(uploads, photo.storageKey)), {
        recursive: true,
      });
      await writeFile(join(uploads, photo.storageKey), picture);
      await prisma.importJob.update({
        where: { id: c.jobId },
        data: { status: 'COLLECTED' },
      });
      // A file the journal does not name must never be taken for a leftover.
      const newer = `${a.id}/jobs/${c.jobId}/documents/${randomUUID()}.pdf`;
      await writeFile(join(uploads, newer), 'uploaded after the dump');
      const stem = photo.storageKey.split('/').pop()!;

      expect(await run(false)).toEqual(['would-apply']);
      expect(await filesUnder(a.id)).toContain(stem);
      expect(await rowsMentioning([c.person.email])).not.toEqual([]);

      expect(await run(true)).toEqual(['applied']);
      expect(await rowsMentioning([c.person.email])).toEqual([]);
      expect(await filesUnder(a.id)).not.toContain(stem);
      expect(await filesUnder(a.id)).toContain(newer.split('/').pop());
      expect(await run(true)).toEqual(['already']);
    },
    SLOW,
  );

  it(
    'does not erase when the journal cannot be written',
    async () => {
      const a = await workspace();
      const c = await customerWithHistory(a);
      const journal = app.get(ErasureJournal, { strict: false });
      const broken = jest
        .spyOn(journal, 'append')
        .mockRejectedValueOnce(new Error('disk is full'));
      await erase(a, c.customerId).then((r) => expect(r.status).toBe(500));
      broken.mockRestore();
      expect(
        await prisma.customer.findUniqueOrThrow({
          where: { id: c.customerId },
        }),
      ).toMatchObject({ email: c.person.email, erasedAt: null });
      expect(await filesUnder(a.id)).toContain(c.orphan.split('/').pop());
    },
    SLOW,
  );
});
