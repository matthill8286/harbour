/**
 * The photo and document routes, for staff and for the customer portal, with two
 * organisations, a real PostgreSQL database and real files. Skipped unless
 * TEST_DATABASE_URL names a scratch database that already has the schema.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { FileDeliveryService } from '../integrations/file-delivery.service';
import { NotificationsService } from '../integrations/notifications.service';
import { StorageService } from '../integrations/storage.service';
import { PortalController } from '../portal/portal.controller';
import { PortalService } from '../portal/portal.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowRoutesService } from '../workflow/workflow-routes.service';
import { JobFilesController } from './job-files.controller';
import { JobFilesService } from './job-files.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;
const GREEK = 'Φωτογραφία "μπροστά".jpg';
const SECRET = 'FixtureCam';

/** Collects a response body of any type. */
const binary = (
  response: request.Response,
  done: (error: Error | null, body: Buffer) => void,
) => {
  const stream = response as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => done(null, Buffer.concat(chunks)));
};

describeWithDatabase('job files against PostgreSQL', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let workflows: WorkflowRoutesService;
  let root: string;
  let photoBytes: Buffer;
  const users = new Map<string, AuthUser>();

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    root = await mkdtemp(join(tmpdir(), 'harbour-job-files-'));
    prisma = new PrismaService();
    await prisma.$connect();
    const env: Record<string, string> = {
      STORAGE_LOCAL_DIR: root,
      STORAGE_MIN_FREE_MB: '1',
    };
    const config = {
      get: (key: string, fallback?: string) => env[key] ?? fallback,
    };
    // Signs in as whoever the test names. Roles are still checked for real.
    const signIn: CanActivate = {
      canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest<{
          headers: Record<string, string>;
          user?: AuthUser;
        }>();
        req.user = users.get(req.headers['x-test-user']);
        return Boolean(req.user);
      },
    };
    const module = await Test.createTestingModule({
      controllers: [JobFilesController, PortalController],
      providers: [
        JobFilesService,
        PortalService,
        FileDeliveryService,
        StorageService,
        AuditService,
        WorkflowRoutesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: NotificationsService, useValue: { notify: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(signIn)
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    workflows = module.get(WorkflowRoutesService);
    photoBytes = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: '#336699',
      },
    })
      .jpeg()
      .withExif({
        IFD0: { Make: SECRET },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 10/1 0/1' },
      })
      .toBuffer();
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    if (root) await rm(root, { recursive: true, force: true });
  });

  function signedIn(
    organisationId: string,
    id: string,
    role: 'STAFF' | 'CUSTOMER',
    customerId?: string,
  ) {
    users.set(id, {
      id,
      organisationId,
      role,
      customerId,
    } as AuthUser);
    return id;
  }

  /** A workspace with a staff member, a customer and that customer's job. */
  async function workspace() {
    const id = randomUUID();
    await prisma.organisation.create({ data: { id, name: id, slug: id } });
    const person = (name: string) =>
      prisma.user.create({
        data: { email: `${name}-${id}@example.test`, name },
      });
    const [staff, portalUser] = [await person('s'), await person('c')];
    const customer = await prisma.customer.create({
      data: { organisationId: id, firstName: 'A', lastName: 'B' },
    });
    const vehicle = await prisma.vehicle.create({
      data: { organisationId: id },
    });
    const route = await workflows.ensureDefault(id);
    const job = await prisma.importJob.create({
      data: {
        organisationId: id,
        reference: 'CY-1',
        customerId: customer.id,
        vehicleId: vehicle.id,
        routeId: route.id,
        status: route.stages[0].statuses[0].code,
      },
    });
    return {
      id,
      jobId: job.id,
      staff: signedIn(id, staff.id, 'STAFF'),
      customer: signedIn(id, portalUser.id, 'CUSTOMER', customer.id),
    };
  }
  type Workspace = Awaited<ReturnType<typeof workspace>>;

  const call = (
    user: string,
    method: 'get' | 'post' | 'delete' | 'patch',
    path: string,
  ) => request(app.getHttpServer())[method](path).set('x-test-user', user);

  const fetchFile = (user: string, path: string) =>
    call(user, 'get', path).buffer(true).parse(binary);

  const staffPath = (w: Workspace, rest: string) =>
    `/import-jobs/${w.jobId}/${rest}`;
  const portalPath = (w: Workspace, rest: string) =>
    `/portal/jobs/${w.jobId}/${rest}`;

  async function upload(
    w: Workspace,
    kind: 'photos' | 'documents',
    bytes: Buffer,
    filename: string,
    contentType: string,
    fields: Record<string, string> = {},
  ) {
    const pending = call(w.staff, 'post', staffPath(w, kind)).attach(
      'file',
      bytes,
      { filename, contentType },
    );
    for (const [name, value] of Object.entries(fields)) {
      void pending.field(name, value);
    }
    return pending;
  }

  const sharedPhoto = async (w: Workspace) =>
    (
      await upload(w, 'photos', photoBytes, GREEK, 'image/jpeg', {
        category: 'DAMAGE',
        customerVisible: 'true',
      })
    ).body as { id: string; filename: string };

  const filesOf = async (organisationId: string) => {
    const entries = await readdir(join(root, organisationId), {
      recursive: true,
      withFileTypes: true,
    }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  };

  it.each([
    ['photos', { category: 'SELFIE' }, 'That photo category is not recognised'],
    ['photos', { category: '' }, 'That photo category is not recognised'],
    ['documents', { type: 'SECRET' }, 'That document type is not recognised'],
    ['documents', { type: 'toString' }, 'That document type is not recognised'],
  ] as const)(
    'refuses %s with %o before writing anything',
    async (kind, fields, message) => {
      const w = await workspace();
      const response = await upload(
        w,
        kind,
        photoBytes,
        'a.jpg',
        'image/jpeg',
        fields,
      );
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ message });
      expect(await filesOf(w.id)).toEqual([]);
    },
  );

  it('refuses a photo that cannot be read, and writes nothing', async () => {
    const w = await workspace();
    const response = await upload(
      w,
      'photos',
      Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2]),
      'broken.jpg',
      'image/jpeg',
    );
    expect(response.status).toBe(400);
    expect(await filesOf(w.id)).toEqual([]);
  });

  it('keeps the original as uploaded and the Greek name with its quotes', async () => {
    const w = await workspace();
    const photo = await sharedPhoto(w);
    expect(photo.filename).toBe(GREEK);
    expect(photo).not.toHaveProperty('storageKey');
    expect(await filesOf(w.id)).toHaveLength(3);
    const original = await fetchFile(
      w.staff,
      staffPath(w, `photos/${photo.id}?size=original`),
    ).expect(200);
    expect(original.body).toEqual(photoBytes);
    const header = original.headers['content-disposition'];
    expect(decodeURIComponent(header.split("UTF-8''")[1])).toBe(GREEK);
  });

  it('gives staff and customers copies without metadata', async () => {
    const w = await workspace();
    const { id } = await sharedPhoto(w);
    for (const [user, path] of [
      [w.staff, staffPath(w, `photos/${id}`)],
      [w.customer, portalPath(w, `photos/${id}`)],
      // The portal has no original: anything unknown is the display copy.
      [w.customer, portalPath(w, `photos/${id}?size=original`)],
    ]) {
      const response = await fetchFile(user, path).expect(200);
      const body = response.body as Buffer;
      expect(body.includes(SECRET)).toBe(false);
      expect((await sharp(body).metadata()).exif).toBeUndefined();
      expect(Number(response.headers['content-length'])).toBe(body.length);
      expect(response.headers['content-type']).toBe('image/jpeg');
    }
    const thumb = await fetchFile(
      w.customer,
      portalPath(w, `photos/${id}?size=thumb`),
    ).expect(200);
    expect((await sharp(thumb.body as Buffer).metadata()).width).toBe(640);
  });

  it('cleans a photo stored before copies existed, without touching it', async () => {
    const w = await workspace();
    const storageKey = `${w.id}/jobs/${w.jobId}/photos/old.jpg`;
    await mkdir(dirname(join(root, storageKey)), { recursive: true });
    await writeFile(join(root, storageKey), photoBytes);
    const old = await prisma.photo.create({
      data: {
        organisationId: w.id,
        importJobId: w.jobId,
        filename: 'old.jpg',
        mimeType: 'image/jpeg',
        storageKey,
        sizeBytes: photoBytes.length,
        customerVisible: true,
      },
    });
    const path = portalPath(w, `photos/${old.id}?size=thumb`);
    const [first, second] = await Promise.all([
      fetchFile(w.customer, path),
      fetchFile(w.customer, path),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body).toEqual(second.body);
    expect((first.body as Buffer).includes(SECRET)).toBe(false);
    expect(await filesOf(w.id)).toEqual(['old.jpg', 'old.jpg.v1.thumb.jpg']);
    const original = await fetchFile(
      w.staff,
      staffPath(w, `photos/${old.id}?size=original`),
    );
    expect(original.body).toEqual(photoBytes);
  });

  it('never sends a customer the original of an unreadable photo', async () => {
    const w = await workspace();
    const storageKey = `${w.id}/jobs/${w.jobId}/photos/bad.jpg`;
    await mkdir(dirname(join(root, storageKey)), { recursive: true });
    await writeFile(join(root, storageKey), `not a picture ${SECRET}`);
    const bad = await prisma.photo.create({
      data: {
        organisationId: w.id,
        importJobId: w.jobId,
        filename: 'bad.jpg',
        mimeType: 'image/jpeg',
        storageKey,
        sizeBytes: 10,
        customerVisible: true,
      },
    });
    const response = await call(
      w.customer,
      'get',
      portalPath(w, `photos/${bad.id}`),
    ).expect(422);
    expect(response.text).not.toContain(SECRET);
  });

  it('cleans a photo shared as a document, and passes a PDF through', async () => {
    const w = await workspace();
    const picture = await upload(
      w,
      'documents',
      photoBytes,
      'σάρωση.jpg',
      'image/jpeg',
      { type: 'V5C', customerVisible: 'true' },
    );
    const clean = await fetchFile(
      w.customer,
      portalPath(w, `documents/${picture.body.id}`),
    ).expect(200);
    expect((clean.body as Buffer).includes(SECRET)).toBe(false);
    expect((await sharp(clean.body as Buffer).metadata()).width).toBe(1200);

    const pdfBytes = Buffer.from('%PDF-1.4 test');
    const pdf = await upload(
      w,
      'documents',
      pdfBytes,
      'Τιμολόγιο.pdf',
      'application/pdf',
      { customerVisible: 'true' },
    );
    const sent = await fetchFile(
      w.customer,
      portalPath(w, `documents/${pdf.body.id}`),
    ).expect(200);
    expect(sent.body).toEqual(pdfBytes);
    expect(sent.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('Τιμολόγιο.pdf')}`,
    );
    const job = await call(w.customer, 'get', `/portal/jobs/${w.jobId}`);
    expect(JSON.stringify(job.body)).not.toContain('storageKey');
  });

  it('keeps one organisation away from another one’s files', async () => {
    const [a, b] = [await workspace(), await workspace()];
    const { id } = await sharedPhoto(a);
    const document = await upload(
      a,
      'documents',
      Buffer.from('%PDF-1.4'),
      'a.pdf',
      'application/pdf',
      { customerVisible: 'true' },
    );
    const before = await filesOf(a.id);
    for (const [kind, fileId] of [
      ['photos', id],
      ['documents', document.body.id as string],
    ]) {
      // With A's job, and with B's own job and A's file.
      for (const job of [a, b]) {
        const path = staffPath(job, `${kind}/${fileId}`);
        await call(b.staff, 'get', path).expect(404);
        await call(b.staff, 'delete', path).expect(404);
        await call(b.staff, 'patch', path)
          .send({ customerVisible: false })
          .expect(404);
        await call(
          b.customer,
          'get',
          portalPath(job, `${kind}/${fileId}`),
        ).expect(404);
      }
    }
    await call(b.staff, 'post', staffPath(a, 'photos'))
      .attach('file', photoBytes, 'x.jpg')
      .expect(404);
    expect(await filesOf(a.id)).toEqual(before);
    expect(await filesOf(b.id)).toEqual([]);
    expect(await prisma.photo.count({ where: { organisationId: a.id } })).toBe(
      1,
    );
    expect(
      await prisma.auditLog.count({
        where: { organisationId: b.id, action: { endsWith: '_DELETED' } },
      }),
    ).toBe(0);
  });

  it('shows a customer only their own shared files, and lets them delete none', async () => {
    const w = await workspace();
    const { id } = await sharedPhoto(w);
    const stranger = await prisma.customer.create({
      data: { organisationId: w.id, firstName: 'C', lastName: 'D' },
    });
    const other = signedIn(w.id, randomUUID(), 'CUSTOMER', stranger.id);
    await call(other, 'get', portalPath(w, `photos/${id}`)).expect(404);
    await call(w.customer, 'delete', staffPath(w, `photos/${id}`)).expect(403);
    await call(w.customer, 'get', staffPath(w, `photos/${id}`)).expect(403);
    await call(w.staff, 'patch', staffPath(w, `photos/${id}`))
      .send({ customerVisible: false })
      .expect(200);
    await call(w.customer, 'get', portalPath(w, `photos/${id}`)).expect(404);
  });

  it('deletes a file and its copies, once, with an audit entry', async () => {
    const w = await workspace();
    const { id } = await sharedPhoto(w);
    const keep = await upload(
      w,
      'documents',
      Buffer.from('%PDF-1.4'),
      'keep.pdf',
      'application/pdf',
    );
    const path = staffPath(w, `photos/${id}`);
    const results = await Promise.all([
      call(w.staff, 'delete', path),
      call(w.staff, 'delete', path),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
    await call(w.staff, 'get', path).expect(404);
    expect(await filesOf(w.id)).toHaveLength(1);
    const entries = await prisma.auditLog.findMany({
      where: { organisationId: w.id, action: 'PHOTO_DELETED' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: w.staff,
      entityId: id,
      metadata: { importJobId: w.jobId, name: GREEK },
    });
    await call(
      w.staff,
      'delete',
      staffPath(w, `documents/${keep.body.id}`),
    ).expect(204);
    expect(await filesOf(w.id)).toEqual([]);
  });
});
