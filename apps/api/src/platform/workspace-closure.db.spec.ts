/**
 * Exporting a whole workspace over real HTTP, and the operator's closing and
 * deleting of it, with two workspaces, real files and a real journal, against
 * a real PostgreSQL database. Skipped unless TEST_DATABASE_URL names a scratch
 * database that already has the schema:
 *
 *   DATABASE_URL=<scratch url> pnpm run db:deploy
 *   TEST_DATABASE_URL=<scratch url> pnpm exec jest db.spec
 */
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { FileDeliveryService } from '../integrations/file-delivery.service';
import { StorageService } from '../integrations/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerErasureService } from '../privacy/customer-erasure.service';
import { ErasureJournal } from '../privacy/erasure-journal';
import { reapplyErasures } from '../privacy/reapply-erasures';
import { UsageService } from '../tenancy/usage.service';
import { GpsIndexesService } from '../tracking/gps-indexes.service';
import { GpsRetentionService } from '../tracking/gps-retention.service';
import { WorkflowRoutesService } from '../workflow/workflow-routes.service';
import { runOperatorCommand } from './operator-command';
import { parseContractEnd } from './workspace-closure';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;
const SLOW = 60_000;
const DAY = 24 * 60 * 60 * 1000;

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

describeWithDatabase('exporting and deleting a whole workspace', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let uploads: string;
  let journal: ErasureJournal;
  let storage: StorageService;
  let operatorEmail: string;
  const env = { ...process.env };

  beforeAll(async () => {
    uploads = await mkdtemp(join(tmpdir(), 'harbour-closure-'));
    Object.assign(process.env, {
      DATABASE_URL: url,
      JWT_SECRET: randomUUID() + randomUUID(),
      TWO_FACTOR_ENCRYPTION_KEY: randomUUID() + randomUUID(),
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
    const config = new ConfigService();
    journal = new ErasureJournal(config);
    storage = new StorageService(config);

    const operator = await prisma.user.create({
      data: {
        email: `operator-${randomUUID()}@example.test`,
        name: 'Operator',
        passwordHash: 'a-hash',
        twoFactorEnabled: true,
        platformAdmin: { create: {} },
      },
    });
    operatorEmail = operator.email;
  }, SLOW);

  afterAll(async () => {
    await app?.close();
    await rm(uploads, { recursive: true, force: true });
    process.env = env;
    jest.restoreAllMocks();
  });

  const deps = () => ({
    journal: (entry: Parameters<ErasureJournal['append']>[0]) =>
      journal.append(entry),
    removeFiles: (organisationId: string) =>
      storage.removeWorkspace(organisationId),
  });
  const operator = (...args: string[]) =>
    runOperatorCommand(prisma, args, deps());

  /** A workspace with an Admin, a Staff member, a job, a position and a file. */
  async function workspace(subscription: object = {}) {
    const slug = `closure-${randomUUID()}`;
    const organisation = await prisma.organisation.create({
      data: {
        name: slug,
        slug,
        subscription: { create: subscription },
        settings: { create: { gpsWebhookSecretHash: 'a-secret-hash' } },
      },
    });
    const member = async (role: 'ADMIN' | 'STAFF', userId?: string) => {
      const user = userId
        ? await prisma.user.findUniqueOrThrow({ where: { id: userId } })
        : await prisma.user.create({
            data: {
              email: `${randomUUID()}@example.test`,
              name: `${role} person`,
              passwordHash: 'a-password-hash',
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
    const customer = await prisma.customer.create({
      data: {
        organisationId: organisation.id,
        firstName: 'Zed',
        lastName: 'Quill',
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: { organisationId: organisation.id, vin: `VIN${randomUUID()}` },
    });
    const job = await prisma.importJob.create({
      data: {
        organisationId: organisation.id,
        customerId: customer.id,
        vehicleId: vehicle.id,
        reference: `REF-${randomUUID()}`,
      },
    });
    await prisma.locationEvent.create({
      data: {
        organisationId: organisation.id,
        importJobId: job.id,
        vehicleId: vehicle.id,
        latitude: 34.7,
        longitude: 33.1,
        recordedAt: new Date(),
      },
    });
    const storageKey = `${organisation.id}/jobs/${job.id}/documents/${randomUUID()}.pdf`;
    await mkdir(dirname(join(uploads, storageKey)), { recursive: true });
    await writeFile(join(uploads, storageKey), '%PDF-1.4 invoice');
    await prisma.document.create({
      data: {
        organisationId: organisation.id,
        importJobId: job.id,
        name: 'Invoice.pdf',
        mimeType: 'application/pdf',
        storageKey,
        sizeBytes: 16,
      },
    });
    return {
      id: organisation.id,
      slug,
      admin: await member('ADMIN'),
      staff: await member('STAFF'),
      member,
    };
  }

  const exportOf = (token: string) =>
    request(app.getHttpServer())
      .get('/api/organisation/export')
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });

  it(
    'exports every table, GPS positions and files, for Admins only, and none of another workspace',
    async () => {
      const ours = await workspace();
      const theirs = await workspace();

      await exportOf(ours.staff.token).expect(403);
      const response = await exportOf(ours.admin.token).expect(200);
      const zip = unzip(response.body as Buffer);

      const positions = zip.get('data/LocationEvent.jsonl')!.toString();
      expect(positions.trim().split('\n')).toHaveLength(1);
      expect(JSON.parse(positions)).toMatchObject({
        organisationId: ours.id,
        // Decimals keep their exact value as text.
        latitude: '34.7',
      });
      expect(zip.get('data/ImportJob.jsonl')!.toString()).toContain(ours.id);
      expect(
        [...zip.keys()].filter((name) => name.startsWith('files/')),
      ).toHaveLength(1);
      expect(
        [...zip.values()].find((body) =>
          body.toString().startsWith('%PDF-1.4 invoice'),
        ),
      ).toBeDefined();
      const workspaceJson = JSON.parse(zip.get('workspace.json')!.toString());
      expect(workspaceJson.memberships).toHaveLength(2);

      const everything = [...zip.values()].map(String).join('\n');
      expect(everything).not.toContain(theirs.id);
      expect(everything).not.toContain('a-secret-hash');
      expect(everything).not.toContain('a-password-hash');

      const audit = await prisma.auditLog.findFirst({
        where: { organisationId: ours.id, action: 'WORKSPACE_DATA_EXPORTED' },
      });
      expect(audit?.actorId).toBe(ours.admin.user.id);
    },
    SLOW,
  );

  it('exports while a lapsed plan has made the workspace read-only', async () => {
    const lapsed = await workspace({
      status: 'CANCELLED',
      readOnlyFrom: new Date(Date.now() - DAY),
    });
    await exportOf(lapsed.admin.token).expect(200);
  });

  it(
    'deletes a workspace only after the notice, and only what is its own',
    async () => {
      const leaving = await workspace();
      const staying = await workspace();
      // The Admin of the leaving workspace also works in the other one.
      await staying.member('STAFF', leaving.admin.user.id);

      const ended = new Date(Date.now() - DAY).toISOString().slice(0, 10);
      await expect(
        operator(
          'close',
          leaving.slug,
          '--by',
          operatorEmail,
          '--contract-end',
          ended,
          '--reason',
          'Contract ended by the client',
        ),
      ).resolves.toContain('can be deleted after');
      // The notice period has not passed, so nothing can be deleted yet.
      await expect(
        operator('delete-closed', leaving.slug, '--by', operatorEmail),
      ).rejects.toThrow('cannot be deleted before');

      // The workspace keeps working through the notice, export included.
      await exportOf(leaving.admin.token).expect(200);
      const view = await request(app.getHttpServer())
        .get('/api/organisation')
        .set('Authorization', `Bearer ${leaving.admin.token}`)
        .expect(200);
      expect(view.body.closure.deleteAfter).toBeTruthy();

      // Move the notice into the past.
      await prisma.workspaceClosure.update({
        where: { organisationId: leaving.id },
        data: { deleteAfter: new Date(Date.now() - 1000) },
      });
      await expect(
        operator('delete-closed', leaving.slug, '--by', operatorEmail),
      ).resolves.toContain('Nothing was changed');
      expect(
        await prisma.organisation.findUnique({ where: { id: leaving.id } }),
      ).not.toBeNull();

      await expect(
        operator(
          'delete-closed',
          leaving.slug,
          '--by',
          operatorEmail,
          '--confirm',
        ),
      ).resolves.toContain('are deleted');

      for (const count of await Promise.all([
        prisma.organisation.count({ where: { id: leaving.id } }),
        prisma.importJob.count({ where: { organisationId: leaving.id } }),
        prisma.locationEvent.count({ where: { organisationId: leaving.id } }),
        prisma.customer.count({ where: { organisationId: leaving.id } }),
        prisma.user.count({ where: { id: leaving.staff.user.id } }),
      ])) {
        expect(count).toBe(0);
      }
      // An account another workspace uses is kept, and so is that workspace.
      expect(
        await prisma.user.count({ where: { id: leaving.admin.user.id } }),
      ).toBe(1);
      expect(
        await prisma.importJob.count({ where: { organisationId: staying.id } }),
      ).toBe(1);
      expect(await readdir(uploads)).not.toContain(leaving.id);
      expect(await readdir(uploads)).toContain(staying.id);

      const log = await prisma.platformAuditLog.findFirst({
        where: { action: 'WORKSPACE_DELETED', targetId: leaving.id },
      });
      expect(log?.reason).toBe('Contract ended by the client');
      const entries = await journal.read();
      expect(entries).toContainEqual(
        expect.objectContaining({
          type: 'workspace-deletion',
          organisationId: leaving.id,
        }),
      );

      // A restore that brings the workspace back is undone by `erasures apply`.
      await prisma.organisation.create({
        data: { id: leaving.id, name: 'Restored', slug: `${leaving.slug}-r` },
      });
      const erasures = new CustomerErasureService(
        prisma,
        storage,
        new FileDeliveryService(storage),
        journal,
      );
      const deletion = entries.filter(
        (entry) =>
          entry.type === 'workspace-deletion' &&
          entry.organisationId === leaving.id,
      );
      const results = await reapplyErasures(prisma, erasures, deletion, {
        confirm: true,
      });
      expect(results.map((result) => result.outcome)).toEqual(['applied']);
      expect(
        await prisma.organisation.count({ where: { id: leaving.id } }),
      ).toBe(0);
    },
    SLOW,
  );

  /** Waits until a session is blocked on a lock while running `fragment`. */
  async function blockedOn(fragment: string) {
    const pattern = `%${fragment}%`;
    for (let tries = 0; tries < 100; tries += 1) {
      const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE ${pattern}`;
      if (waiting > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Nothing waited on a lock while running ${fragment}`);
  }

  it(
    'deletes a workspace and backfills usage at the same time without a deadlock',
    async () => {
      const leaving = await workspace();
      const ended = new Date(Date.now() - DAY).toISOString().slice(0, 10);
      await operator(
        'close',
        leaving.slug,
        '--by',
        operatorEmail,
        '--contract-end',
        ended,
        '--reason',
        'Contract ended by the client',
      );
      await prisma.workspaceClosure.update({
        where: { organisationId: leaving.id },
        data: { deleteAfter: new Date(Date.now() - 1000) },
      });
      const usage = app.get(UsageService);

      // The order that deadlocked: the deletion reaches the organisation's
      // row first, then the backfill takes its table lock and needs that row
      // to count the workspace's job. A held row lock lines them up so.
      let deletion: Promise<string> | undefined;
      let backfill: Promise<number> | undefined;
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${leaving.id} FOR UPDATE`;
          deletion = operator(
            'delete-closed',
            leaving.slug,
            '--by',
            operatorEmail,
            '--confirm',
          );
          await blockedOn('DELETE FROM "public"."Organisation"');
          backfill = usage.backfillImportJobs();
          await blockedOn('"UsageRecord"');
        },
        { timeout: 20_000 },
      );

      await expect(deletion).resolves.toContain('are deleted');
      await expect(backfill).resolves.toEqual(expect.any(Number));
      expect(
        await prisma.organisation.count({ where: { id: leaving.id } }),
      ).toBe(0);
      expect(
        await prisma.usageRecord.count({
          where: { organisationId: leaving.id },
        }),
      ).toBe(0);
    },
    SLOW,
  );

  it('refuses a closure without an operator, a reason or a real date', async () => {
    const ws = await workspace();
    await expect(
      operator(
        'close',
        ws.slug,
        '--by',
        ws.admin.user.email,
        '--contract-end',
        '2026-01-31',
        '--reason',
        'Contract ended by the client',
      ),
    ).rejects.toThrow('not a platform operator');
    await expect(
      operator(
        'close',
        ws.slug,
        '--by',
        operatorEmail,
        '--contract-end',
        '2026-01-31',
        '--reason',
        'short',
      ),
    ).rejects.toThrow('Give a reason');
    expect(() => parseContractEnd('2026-02-30')).toThrow('YYYY-MM-DD');
    await expect(
      operator(
        'cancel-close',
        ws.slug,
        '--by',
        operatorEmail,
        '--reason',
        'Client renewed the contract',
      ),
    ).rejects.toThrow('not due for deletion');
  });
});
