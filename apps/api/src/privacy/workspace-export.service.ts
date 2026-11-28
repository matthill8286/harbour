import { Injectable, Logger, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../integrations/storage.service';
import { cleanFileName, contentDisposition } from '../common/file-names';
import type { AuthUser } from '../auth/auth.types';

/** Rows read from the database at a time, so a large table is never held whole. */
const PAGE = 2000;

/** Secrets, and hashes of them, never leave the database. */
const SECRET_FIELDS = new Set([
  'passwordHash',
  'tokenHash',
  'gpsWebhookSecretHash',
  'secret',
  'backupCodes',
]);

/**
 * Tables that belong to a workspace through a parent rather than by their own
 * `organisationId`, and the filter that finds a workspace's rows.
 */
const THROUGH_PARENT: Record<string, (organisationId: string) => object> = {
  RouteStage: (organisationId) => ({ route: { organisationId } }),
  RouteStatus: (organisationId) => ({ route: { organisationId } }),
  ErasureReviewItem: (organisationId) => ({ erasure: { organisationId } }),
};

type Table = { name: string; delegate: string; idField: string };
type Delegate = {
  findMany(args: object): Promise<Array<Record<string, unknown>>>;
};

/**
 * Everything one workspace holds, as a ZIP, for its Admins: every table that
 * belongs to it as JSON Lines under `data/`, GPS positions included, and every
 * document and photo as it was uploaded under `files/`. It is the business's
 * own copy of its data, so files are the originals. A lapsed or read-only plan
 * never blocks it.
 */
@Injectable()
export class WorkspaceExportService {
  private readonly logger = new Logger(WorkspaceExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Every table with rows that belong to one workspace. */
  static tables(): Table[] {
    return Prisma.dmmf.datamodel.models.flatMap((model) => {
      const scoped = model.fields.some(
        (field) => field.name === 'organisationId' && field.kind === 'scalar',
      );
      const through = THROUGH_PARENT[model.name];
      if (model.name === 'Organisation' || (!scoped && !through)) return [];
      const idField =
        model.fields.find((field) => field.isId)?.name ?? 'organisationId';
      return [
        {
          name: model.name,
          delegate: model.name.charAt(0).toLowerCase() + model.name.slice(1),
          idField,
        },
      ];
    });
  }

  async export(user: AuthUser): Promise<StreamableFile> {
    const organisationId = user.organisationId;
    const organisation = await this.prisma.organisation.findUniqueOrThrow({
      where: { id: organisationId },
      include: {
        memberships: {
          select: {
            id: true,
            role: true,
            status: true,
            customerId: true,
            acceptedAt: true,
            createdAt: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    const files = await this.files(organisationId);
    const tables = WorkspaceExportService.tables();

    // Recorded before any of it leaves, with counts only.
    await this.prisma.auditLog.create({
      data: {
        organisationId,
        actorId: user.id,
        action: 'WORKSPACE_DATA_EXPORTED',
        entityType: 'Organisation',
        entityId: organisationId,
        metadata: { tables: tables.length, files: files.length },
      },
    });

    const zip = new ZipFile();
    const missing: string[] = [];
    zip.addBuffer(
      Buffer.from(JSON.stringify(organisation, null, 2)),
      'workspace.json',
    );
    for (const table of tables) {
      zip.addReadStreamLazy(`data/${table.name}.jsonl`, (done) => {
        done(null, Readable.from(this.rows(table, organisationId)));
      });
    }
    for (const file of files) {
      if (!(await this.storage.exists(file.storageKey, organisationId))) {
        missing.push(file.path);
        continue;
      }
      // Opened only when the archive reaches it, so one file is held at a time.
      zip.addReadStreamLazy(file.path, (done) => {
        this.storage.stream(file.storageKey, organisationId).then(
          ({ stream }) => done(null, stream),
          (error: Error) => {
            this.logger.error(`Export stopped at ${file.path}`, error);
            done(error, undefined as never);
          },
        );
      });
    }
    zip.addBuffer(
      Buffer.from(
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            workspace: organisation.slug,
            tables: tables.map((table) => `data/${table.name}.jsonl`),
            files: files.length - missing.length,
            missingFiles: missing,
            secretsLeftOut: [...SECRET_FIELDS],
          },
          null,
          2,
        ),
      ),
      'manifest.json',
    );
    zip.end();
    const output =
      zip.outputStream as unknown as import('node:stream').Readable;
    // A table or file that cannot be read cuts the download short, so it is
    // not mistaken for a whole export.
    zip.on('error', (error: Error) => output.destroy(error));
    return new StreamableFile(output, {
      type: 'application/zip',
      disposition: contentDisposition(
        'attachment',
        `harbour-${cleanFileName(organisation.slug, 'workspace')}.zip`,
      ),
    });
  }

  /** One JSON object a line, read a page at a time in id order. */
  private async *rows(table: Table, organisationId: string) {
    const delegate = (this.prisma as unknown as Record<string, Delegate>)[
      table.delegate
    ];
    const through = THROUGH_PARENT[table.name];
    const where = through ? through(organisationId) : { organisationId };
    let after: unknown = undefined;
    for (;;) {
      const page = await delegate.findMany({
        where:
          after === undefined
            ? where
            : { AND: [where, { [table.idField]: { gt: after } }] },
        orderBy: { [table.idField]: 'asc' },
        take: PAGE,
      });
      for (const row of page) {
        yield `${JSON.stringify(row, withoutSecrets)}\n`;
      }
      if (page.length < PAGE) return;
      after = page[page.length - 1][table.idField];
    }
  }

  private async files(organisationId: string) {
    const [documents, photos] = await Promise.all([
      this.prisma.document.findMany({
        where: { organisationId },
        select: { id: true, importJobId: true, storageKey: true, name: true },
      }),
      this.prisma.photo.findMany({
        where: { organisationId },
        select: {
          id: true,
          importJobId: true,
          storageKey: true,
          filename: true,
        },
      }),
    ]);
    const path = (
      folder: string,
      file: { id: string; importJobId: string; storageKey: string },
      name: string,
    ) => ({
      storageKey: file.storageKey,
      path: `files/${file.importJobId}/${folder}/${file.id}-${cleanFileName(name, folder)}`,
    });
    return [
      ...documents.map((file) => path('documents', file, file.name)),
      ...photos.map((file) => path('photos', file, file.filename)),
    ];
  }
}

function withoutSecrets(key: string, value: unknown) {
  return SECRET_FIELDS.has(key) ? undefined : value;
}
