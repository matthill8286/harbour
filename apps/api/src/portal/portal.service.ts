import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import {
  customerJourney,
  customerProgress,
  customerStatusLabel,
  routeStatusCodes,
  type RouteWorkflow,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../integrations/storage.service';
import type { AuthUser } from '../auth/auth.types';
import { WorkflowRoutesService } from '../workflow/workflow-routes.service';
import { toPortalJob } from './portal.view';

const customerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  address: true,
} as const;

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly workflows: WorkflowRoutesService,
    private readonly audit: AuditService,
  ) {}

  /** What the customer sees of a job's route: its visible steps, where the job is, and the label. */
  private view(route: RouteWorkflow, status: string) {
    return {
      statusLabel: customerStatusLabel(route, status),
      progress: customerProgress(route, status),
      journey: customerJourney(route, status),
      routeLabel: route.shortLabel,
      // For the headline: still at the route's first status, or at its last.
      started: status !== routeStatusCodes(route)[0],
      readyToCollect: status === routeStatusCodes(route).slice(-1)[0],
    };
  }

  /** Each route a set of jobs follows, loaded once. */
  private async routesFor(
    organisationId: string,
    routeIds: Array<string | null>,
  ) {
    const routes = new Map<string | null, RouteWorkflow>();
    for (const id of new Set(routeIds)) {
      routes.set(id, await this.workflows.workflowFor(organisationId, id));
    }
    return routes;
  }

  async list(user: AuthUser) {
    const customerId = this.requireCustomer(user);
    const jobs = await this.prisma.importJob.findMany({
      where: { organisationId: user.organisationId, customerId },
      include: {
        vehicle: {
          select: {
            make: true,
            model: true,
            variant: true,
            ukRegistration: true,
            colour: true,
            year: true,
          },
        },
        _count: {
          select: {
            photos: { where: { customerVisible: true } },
            documents: { where: { customerVisible: true } },
          },
        },
        // The first photo shared with the customer is the card's cover.
        photos: {
          where: { customerVisible: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const routes = await this.routesFor(
      user.organisationId,
      jobs.map((job) => job.routeId),
    );
    return jobs.map((job) => ({
      id: job.id,
      reference: job.reference,
      status: job.status,
      ...this.view(routes.get(job.routeId)!, job.status),
      expectedDeliveryDate: job.expectedDeliveryDate,
      completedAt: job.completedAt,
      destinationCountry: job.destinationCountry,
      vehicle: job.vehicle,
      coverPhotoId: job.photos[0]?.id ?? null,
      photoCount: job._count.photos,
      documentCount: job._count.documents,
    }));
  }

  async get(user: AuthUser, id: string) {
    const job = await this.loadCustomerJob(user, id);
    const route = await this.workflows.workflowFor(
      user.organisationId,
      job.routeId,
    );
    const portalJob = toPortalJob(job);
    return {
      ...portalJob,
      ...this.view(route, job.status),
      statusHistory: portalJob.statusHistory.map((entry) => ({
        ...entry,
        label: customerStatusLabel(route, entry.toStatus),
      })),
    };
  }

  async readVisibleFile(
    user: AuthUser,
    jobId: string,
    kind: 'document' | 'photo',
    fileId: string,
  ) {
    await this.loadCustomerJob(user, jobId);
    if (kind === 'document') {
      const document = await this.prisma.document.findFirst({
        where: {
          id: fileId,
          importJobId: jobId,
          organisationId: user.organisationId,
          customerVisible: true,
        },
      });
      if (!document) {
        throw new NotFoundException('Document not found');
      }
      return {
        buffer: await this.storage.read(
          document.storageKey,
          user.organisationId,
        ),
        mimeType: document.mimeType,
        name: document.name,
        inline: false,
      };
    }
    const photo = await this.prisma.photo.findFirst({
      where: {
        id: fileId,
        importJobId: jobId,
        organisationId: user.organisationId,
        customerVisible: true,
      },
    });
    if (!photo) {
      throw new NotFoundException('Photo not found');
    }
    return {
      buffer: await this.storage.read(photo.storageKey, user.organisationId),
      mimeType: photo.mimeType,
      name: photo.filename,
      inline: true,
    };
  }

  toStream(file: {
    buffer: Buffer;
    mimeType: string;
    name: string;
    inline: boolean;
  }) {
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: `${file.inline ? 'inline' : 'attachment'}; filename="${file.name}"`,
    });
  }

  /** The customer's own details, as their importer holds them. */
  async me(user: AuthUser) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: this.requireCustomer(user),
        organisationId: user.organisationId,
      },
      select: customerSelect,
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /**
   * Lets a customer correct their name, phone and address. The email stays,
   * because it is how they sign in. Their sign-in name follows the new name.
   */
  async updateMe(
    user: AuthUser,
    dto: {
      firstName: string;
      lastName: string;
      phone?: string;
      address?: string;
    },
  ) {
    const id = this.requireCustomer(user);
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const [customer] = await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id },
        data: {
          firstName,
          lastName,
          phone: dto.phone?.trim() || null,
          address: dto.address?.trim() || null,
        },
        select: customerSelect,
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { name: `${firstName} ${lastName}`.trim() },
      }),
    ]);
    await this.audit.record(user, {
      action: 'CUSTOMER_UPDATED_OWN_DETAILS',
      entityType: 'Customer',
      entityId: id,
    });
    return customer;
  }

  private requireCustomer(user: AuthUser) {
    if (!user.customerId) {
      throw new ForbiddenException(
        'No customer profile linked to this account',
      );
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
        documents: {
          where: { customerVisible: true },
          orderBy: { createdAt: 'desc' },
        },
        photos: {
          where: { customerVisible: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    return job;
  }
}
