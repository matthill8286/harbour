import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { DocumentType, PhotoCategory, Prisma } from '@prisma/client';
import { DOCUMENT_TYPES, PHOTO_CATEGORIES } from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../integrations/notifications.service';
import { StorageService } from '../integrations/storage.service';
import { FileDeliveryService } from '../integrations/file-delivery.service';
import { cleanFileName } from '../common/file-names';
import { extensionFor } from '../common/file-types';
import type { AuthUser } from '../auth/auth.types';

export type FileKind = 'document' | 'photo';
export type PhotoSize = 'thumb' | 'display' | 'original';

const entity = { document: 'Document', photo: 'Photo' } as const;

/** A document's type or a photo's category. Anything unknown is refused. */
function choice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  what: string,
): T {
  if (value === undefined) return 'OTHER' as T;
  if (allowed.includes(value as T)) return value as T;
  throw new BadRequestException(`That ${what} is not recognised`);
}

/** Where a file is kept is the api's business only. */
function withoutStorageKey<T extends { storageKey: string }>(record: T) {
  const { storageKey, ...rest } = record;
  void storageKey;
  return rest;
}

/** The photos and documents of a job, for staff. */
@Injectable()
export class JobFilesService {
  private readonly logger = new Logger(JobFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly delivery: FileDeliveryService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async addDocument(
    user: AuthUser,
    jobId: string,
    file: Express.Multer.File,
    customerVisible: boolean,
    type?: unknown,
  ) {
    // Everything that can be refused is checked before a file is written.
    const documentType = choice<DocumentType>(
      type,
      DOCUMENT_TYPES,
      'document type',
    );
    const job = await this.requireJob(user, jobId);
    const name = cleanFileName(file.originalname, 'document');
    const document = await this.stored(
      user,
      jobId,
      'documents',
      file,
      [],
      (storageKey) =>
        this.prisma.document.create({
          data: {
            organisationId: user.organisationId,
            importJobId: jobId,
            type: documentType,
            name,
            mimeType: file.mimetype,
            storageKey,
            sizeBytes: file.size,
            uploadedById: user.id,
            customerVisible,
          },
        }),
    );
    void this.audit.record(user, {
      action: 'DOCUMENT_UPLOADED',
      entityType: 'Document',
      entityId: document.id,
      metadata: { importJobId: jobId, customerVisible, name },
    });
    if (customerVisible) {
      this.notifyShared(
        user,
        jobId,
        job.customerId,
        `A document was shared: ${name}`,
      );
    }
    return withoutStorageKey(document);
  }

  async addPhoto(
    user: AuthUser,
    jobId: string,
    file: Express.Multer.File,
    customerVisible: boolean,
    category?: unknown,
  ) {
    const photoCategory = choice<PhotoCategory>(
      category,
      PHOTO_CATEGORIES,
      'photo category',
    );
    const job = await this.requireJob(user, jobId);
    const filename = cleanFileName(file.originalname, 'photo');
    const copies = await this.delivery.photoCopies(file.buffer, file.mimetype);
    const photo = await this.stored(
      user,
      jobId,
      'photos',
      file,
      copies,
      (storageKey) =>
        this.prisma.photo.create({
          data: {
            organisationId: user.organisationId,
            importJobId: jobId,
            category: photoCategory,
            filename,
            mimeType: file.mimetype,
            storageKey,
            sizeBytes: file.size,
            uploadedById: user.id,
            customerVisible,
          },
        }),
    );
    void this.audit.record(user, {
      action: 'PHOTO_UPLOADED',
      entityType: 'Photo',
      entityId: photo.id,
      metadata: { importJobId: jobId, customerVisible, filename },
    });
    if (customerVisible) {
      this.notifyShared(
        user,
        jobId,
        job.customerId,
        `A photo was shared: ${filename}`,
      );
    }
    return withoutStorageKey(photo);
  }

  async setVisibility(
    user: AuthUser,
    jobId: string,
    kind: FileKind,
    fileId: string,
    customerVisible: boolean,
  ) {
    const job = await this.requireJob(user, jobId);
    const existing = await this.find(user, jobId, kind, fileId);
    const update = { where: { id: fileId }, data: { customerVisible } };
    const updated =
      kind === 'document'
        ? await this.prisma.document.update(update)
        : await this.prisma.photo.update(update);
    void this.audit.record(user, {
      action: 'FILE_VISIBILITY_CHANGED',
      entityType: entity[kind],
      entityId: fileId,
      metadata: { importJobId: jobId, customerVisible, name: existing.name },
    });
    if (customerVisible && !existing.customerVisible) {
      this.notifyShared(
        user,
        jobId,
        job.customerId,
        `A file was shared: ${existing.name}`,
      );
    }
    return withoutStorageKey(updated);
  }

  /**
   * Deletes a wrongly uploaded file. The row and the audit entry are written
   * together, so nothing is deleted without a record. The files go afterwards.
   */
  async delete(
    user: AuthUser,
    jobId: string,
    kind: FileKind,
    fileId: string,
  ): Promise<void> {
    const file = await this.find(user, jobId, kind, fileId);
    await this.prisma.$transaction(async (tx) => {
      const where = {
        id: fileId,
        importJobId: jobId,
        organisationId: user.organisationId,
      };
      const { count } =
        kind === 'document'
          ? await tx.document.deleteMany({ where })
          : await tx.photo.deleteMany({ where });
      if (count === 0) throw missing(kind);
      await tx.auditLog.create({
        data: {
          organisationId: user.organisationId,
          actorId: user.id,
          action: kind === 'document' ? 'DOCUMENT_DELETED' : 'PHOTO_DELETED',
          entityType: entity[kind],
          entityId: fileId,
          metadata: {
            importJobId: jobId,
            name: file.name,
            customerVisible: file.customerVisible,
            sizeBytes: file.sizeBytes,
          } satisfies Prisma.InputJsonValue,
        },
      });
    });
    try {
      await this.delivery.remove(file);
    } catch (error) {
      // The file is no longer reachable. It still counts towards the quota.
      this.logger.error(
        `Deleted ${kind} ${fileId}, but not its file ${file.storageKey}`,
        error as Error,
      );
    }
  }

  async downloadDocument(user: AuthUser, jobId: string, fileId: string) {
    const file = await this.find(user, jobId, 'document', fileId);
    return this.delivery.original(file, 'attachment');
  }

  /** `display` unless another size is asked for, so every browser can show it. */
  async viewPhoto(
    user: AuthUser,
    jobId: string,
    fileId: string,
    size: PhotoSize,
  ) {
    const file = await this.find(user, jobId, 'photo', fileId);
    if (size === 'original') return this.delivery.original(file, 'attachment');
    return this.delivery.copy(file, size, 'inline');
  }

  private async requireJob(user: AuthUser, jobId: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, organisationId: user.organisationId },
      select: { customerId: true },
    });
    if (!job) throw new NotFoundException('Import job not found');
    return job;
  }

  private async find(
    user: AuthUser,
    jobId: string,
    kind: FileKind,
    fileId: string,
  ) {
    const where = {
      id: fileId,
      importJobId: jobId,
      organisationId: user.organisationId,
    };
    if (kind === 'document') {
      const document = await this.prisma.document.findFirst({ where });
      if (!document) throw missing(kind);
      return document;
    }
    const photo = await this.prisma.photo.findFirst({ where });
    if (!photo) throw missing(kind);
    return { ...photo, name: photo.filename };
  }

  /** Writes the file, then its row. No file is left behind if the row fails. */
  private async stored<T>(
    user: AuthUser,
    jobId: string,
    kind: 'documents' | 'photos',
    file: Express.Multer.File,
    copies: Parameters<StorageService['save']>[3],
    createRow: (storageKey: string) => Promise<T>,
  ): Promise<T> {
    const storageKey = await this.storage.save(
      file.buffer,
      `file.${extensionFor(file.mimetype)}`,
      {
        organisationId: user.organisationId,
        importJobId: jobId,
        kind,
      },
      copies,
    );
    try {
      return await createRow(storageKey);
    } catch (error) {
      await this.delivery.remove({
        organisationId: user.organisationId,
        storageKey,
        mimeType: file.mimetype,
      });
      throw error;
    }
  }

  private notifyShared(
    user: AuthUser,
    importJobId: string,
    customerId: string | null,
    message: string,
  ) {
    this.notifications.notify({
      type: 'FILE_SHARED',
      organisationId: user.organisationId,
      importJobId,
      customerId,
      message,
    });
  }
}

const missing = (kind: FileKind) =>
  new NotFoundException(`${entity[kind]} not found`);
