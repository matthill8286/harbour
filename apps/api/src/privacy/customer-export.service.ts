import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import { ZipFile } from 'yazl';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../integrations/storage.service';
import { FileDeliveryService } from '../integrations/file-delivery.service';
import { isPicture } from '../integrations/image-renditions';
import { cleanFileName, contentDisposition } from '../common/file-names';
import type { AuthUser } from '../auth/auth.types';
import { mentions } from './erasure-rules';

type ExportFile = {
  organisationId: string;
  storageKey: string;
  mimeType: string;
  name: string;
  path: string;
};

/**
 * One customer's personal data, as a ZIP: `data.json` and their files. Staff are
 * left out by name, because they are other people. Pictures are the copies made
 * without metadata, which would otherwise show who took them and where.
 */
@Injectable()
export class CustomerExportService {
  private readonly logger = new Logger(CustomerExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly delivery: FileDeliveryService,
  ) {}

  async export(user: AuthUser, customerId: string): Promise<StreamableFile> {
    const { data, files } = await this.collect(user, customerId);
    // Recorded before any of it leaves, with ids only.
    await this.prisma.auditLog.create({
      data: {
        organisationId: user.organisationId,
        actorId: user.id,
        action: 'CUSTOMER_DATA_EXPORTED',
        entityType: 'Customer',
        entityId: customerId,
        metadata: { customerId, files: files.length },
      },
    });

    const zip = new ZipFile();
    const missing: string[] = [];
    for (const file of files) {
      if (!(await this.storage.exists(file.storageKey, file.organisationId))) {
        missing.push(file.path);
        continue;
      }
      // Opened only when the archive reaches it, so one file is held at a time.
      zip.addReadStreamLazy(file.path, (done) => {
        this.open(file).then(
          (stream) => done(null, stream),
          (error: Error) => {
            this.logger.error(`Export stopped at ${file.path}`, error);
            done(error, undefined as never);
          },
        );
      });
    }
    zip.addBuffer(
      Buffer.from(JSON.stringify({ ...data, missingFiles: missing }, null, 2)),
      'data.json',
    );
    zip.end();
    const output =
      zip.outputStream as unknown as import('node:stream').Readable;
    // A file that cannot be read cuts the download short, so it is not mistaken
    // for a whole export.
    zip.on('error', (error: Error) => output.destroy(error));
    return new StreamableFile(output, {
      type: 'application/zip',
      disposition: contentDisposition(
        'attachment',
        `customer-${customerId}.zip`,
      ),
    });
  }

  private async open(file: ExportFile) {
    const copy = isPicture(file.mimeType)
      ? await this.delivery.copy(file, 'clean', 'attachment')
      : await this.delivery.original(file, 'attachment');
    return copy.getStream();
  }

  private async collect(user: AuthUser, customerId: string) {
    const organisationId = user.organisationId;
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organisationId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        address: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        memberships: {
          where: { role: 'CUSTOMER' },
          select: {
            status: true,
            acceptedAt: true,
            // Never the name on the account: it is the person's own, and may not
            // be this workspace's to see.
            user: { select: { email: true } },
          },
        },
        portalInvites: {
          select: {
            createdAt: true,
            expiresAt: true,
            acceptedAt: true,
            user: { select: { email: true } },
          },
        },
        jobNotes: {
          select: { body: true, visibility: true, createdAt: true },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const note = { body: true, visibility: true, createdAt: true } as const;
    const jobs = await this.prisma.importJob.findMany({
      where: { organisationId, customerId },
      orderBy: { createdAt: 'asc' },
      include: {
        vehicle: {
          include: {
            registrations: {
              select: {
                kind: true,
                number: true,
                country: true,
                issuedAt: true,
                endedAt: true,
              },
            },
          },
        },
        journeys: true,
        statusHistory: {
          select: {
            fromStatus: true,
            toStatus: true,
            note: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        notes: { select: note },
        tasks: {
          select: {
            title: true,
            description: true,
            status: true,
            dueDate: true,
            completedAt: true,
            notes: { select: note },
          },
        },
        charges: {
          select: {
            category: true,
            description: true,
            amount: true,
            currency: true,
            incurredOn: true,
          },
        },
        costs: true,
        documents: { orderBy: { createdAt: 'asc' } },
        photos: { orderBy: { createdAt: 'asc' } },
        locationEvents: {
          select: {
            latitude: true,
            longitude: true,
            speed: true,
            recordedAt: true,
          },
          orderBy: { recordedAt: 'asc' },
        },
      },
    });

    const files: ExportFile[] = [];
    const add = (
      reference: string,
      folder: string,
      file: { id: string; storageKey: string; mimeType: string },
      name: string,
    ) => {
      const safe = cleanFileName(name, folder);
      const shown =
        isPicture(file.mimeType) && /\.hei[cf]$/i.test(safe)
          ? safe.replace(/\.hei[cf]$/i, '.jpg')
          : safe;
      const path = `files/${cleanFileName(reference, 'job')}/${folder}/${file.id}-${shown}`;
      files.push({
        organisationId,
        storageKey: file.storageKey,
        mimeType: file.mimeType,
        name: safe,
        path,
      });
      return path;
    };

    return {
      files,
      data: {
        exportedAt: new Date().toISOString(),
        customer,
        jobs: jobs.map((job) => ({
          reference: job.reference,
          status: job.status,
          originCountry: job.originCountry,
          destinationCountry: job.destinationCountry,
          registrationCountry: job.registrationCountry,
          expectedDeliveryDate: job.expectedDeliveryDate,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
          vehicle: withoutIds(job.vehicle),
          journeys: job.journeys.map(withoutIds),
          statusHistory: job.statusHistory,
          notes: job.notes,
          tasks: job.tasks,
          charges: job.charges,
          // Supplier costs are the business's own records, unless they name them.
          costsNamingCustomer: job.costs
            .filter((cost) =>
              [cost.description, cost.supplier, cost.invoiceReference].some(
                (text) => mentions(customer, text),
              ),
            )
            .map(withoutIds),
          documents: job.documents.map((file) => ({
            type: file.type,
            name: file.name,
            sharedWithCustomer: file.customerVisible,
            uploadedAt: file.createdAt,
            file: add(job.reference, 'documents', file, file.name),
          })),
          photos: job.photos.map((file) => ({
            category: file.category,
            name: file.filename,
            sharedWithCustomer: file.customerVisible,
            uploadedAt: file.createdAt,
            file: add(job.reference, 'photos', file, file.filename),
          })),
          positions: job.locationEvents,
        })),
      },
    };
  }
}

/** Internal ids mean nothing to the person, and some name staff or workspaces. */
function withoutIds<T extends object>(record: T) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => key !== 'id' && !key.endsWith('Id'),
    ),
  );
}
