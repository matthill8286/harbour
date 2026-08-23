import { ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import type { JobStatus } from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../integrations/storage.service';
import { TrackingService } from '../tracking/tracking.service';
import type { AuthUser } from '../auth/auth.types';
import { toPortalJob } from './portal.view';

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tracking: TrackingService,
  ) {}

  async list(user: AuthUser) {
    const customerId = this.requireCustomer(user);
    const jobs = await this.prisma.importJob.findMany({
      where: { organisationId: user.organisationId, customerId },
      include: {
        vehicle: {
          select: { make: true, model: true, variant: true, ukRegistration: true, colour: true, year: true },
        },
        _count: {
          select: {
            photos: { where: { customerVisible: true } },
            documents: { where: { customerVisible: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return jobs.map((job) => ({
      id: job.id,
      reference: job.reference,
      status: job.status,
      expectedDeliveryDate: job.expectedDeliveryDate,
      vehicle: job.vehicle,
      photoCount: job._count.photos,
      documentCount: job._count.documents,
    }));
  }

  async get(user: AuthUser, id: string) {
    const job = await this.loadCustomerJob(user, id);
    await this.tracking.alignToStatus(job.id, user.organisationId, job.status as JobStatus);
    return toPortalJob(await this.loadCustomerJob(user, id));
  }

  async readVisibleFile(user: AuthUser, jobId: string, kind: 'document' | 'photo', fileId: string) {
    await this.loadCustomerJob(user, jobId);
    if (kind === 'document') {
      const document = await this.prisma.document.findFirst({
        where: { id: fileId, importJobId: jobId, customerVisible: true },
      });
      if (!document) {
        throw new NotFoundException('Document not found');
      }
      return {
        buffer: await this.storage.read(document.storageKey),
        mimeType: document.mimeType,
        name: document.name,
        inline: false,
      };
    }
    const photo = await this.prisma.photo.findFirst({
      where: { id: fileId, importJobId: jobId, customerVisible: true },
    });
    if (!photo) {
      throw new NotFoundException('Photo not found');
    }
    return {
      buffer: await this.storage.read(photo.storageKey),
      mimeType: photo.mimeType,
      name: photo.filename,
      inline: true,
    };
  }

  toStream(file: { buffer: Buffer; mimeType: string; name: string; inline: boolean }) {
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: `${file.inline ? 'inline' : 'attachment'}; filename="${file.name}"`,
    });
  }

  private requireCustomer(user: AuthUser) {
    if (!user.customerId) {
      throw new ForbiddenException('No customer profile linked to this account');
    }
    return user.customerId;
  }

  private async loadCustomerJob(user: AuthUser, id: string) {
    const customerId = this.requireCustomer(user);
    const job = await this.prisma.importJob.findFirst({
      where: { id, organisationId: user.organisationId, customerId },
      include: {
        vehicle: {
          select: {
            make: true,
            model: true,
            variant: true,
            ukRegistration: true,
            colour: true,
            year: true,
            vin: true,
          },
        },
        journeys: { orderBy: { createdAt: 'asc' } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        notes: {
          where: { visibility: 'CUSTOMER' },
          orderBy: { createdAt: 'desc' },
        },
        documents: { where: { customerVisible: true }, orderBy: { createdAt: 'desc' } },
        photos: { where: { customerVisible: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    return job;
  }
}
