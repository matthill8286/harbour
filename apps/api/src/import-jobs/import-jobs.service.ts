import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  getJobStage,
  getStatusLabel,
  JOB_STATUSES,
  STATUS_TRANSITIONS,
  type JobStatus,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../integrations/storage.service';
import { NotificationsService } from '../integrations/notifications.service';
import { AuditService } from '../audit/audit.service';
import { TrackingService } from '../tracking/tracking.service';
import { UsageService } from '../tenancy/usage.service';
import type { AuthUser } from '../auth/auth.types';
import {
  ChangeStatusDto,
  CreateChargeDto,
  CreateCostDto,
  CreateImportJobDto,
  CreateJourneyDto,
  CreateNoteDto,
  CreateTaskDto,
  UpdateImportJobDto,
  UpdateTaskDto,
} from './dto/import-job.dto';

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
} satisfies Prisma.UserSelect;

const jobListInclude = {
  customer: true,
  vehicle: true,
  _count: { select: { tasks: true, documents: true, photos: true } },
} satisfies Prisma.ImportJobInclude;

const jobDetailInclude = {
  customer: true,
  vehicle: { include: { registrations: true } },
  statusHistory: { include: { changedBy: { select: publicUserSelect } }, orderBy: { createdAt: 'asc' } },
  journeys: { orderBy: { createdAt: 'asc' } },
  tasks: { include: { assignedTo: { select: publicUserSelect } }, orderBy: { createdAt: 'desc' } },
  costs: { orderBy: { incurredOn: 'desc' } },
  charges: { orderBy: { incurredOn: 'desc' } },
  notes: { include: { author: { select: publicUserSelect } }, orderBy: { createdAt: 'desc' } },
  documents: { orderBy: { createdAt: 'desc' } },
  photos: { orderBy: { createdAt: 'desc' } },
  trackerAssignments: {
    include: { tracker: true },
    orderBy: { assignedAt: 'desc' },
  },
  locationEvents: { orderBy: { recordedAt: 'desc' }, take: 1 },
} satisfies Prisma.ImportJobInclude;

@Injectable()
export class ImportJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly tracking: TrackingService,
    private readonly usage: UsageService,
  ) {}

  list(user: AuthUser, query?: { status?: string; search?: string }) {
    return this.prisma.importJob.findMany({
      where: {
        organisationId: user.organisationId,
        ...(query?.status ? { status: query.status } : {}),
        ...(query?.search
          ? {
              OR: [
                { reference: { contains: query.search, mode: 'insensitive' } },
                { customer: { firstName: { contains: query.search, mode: 'insensitive' } } },
                { customer: { lastName: { contains: query.search, mode: 'insensitive' } } },
                { vehicle: { make: { contains: query.search, mode: 'insensitive' } } },
                { vehicle: { model: { contains: query.search, mode: 'insensitive' } } },
                { vehicle: { ukRegistration: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: jobListInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const existing = await this.prisma.importJob.findFirst({
      where: { id, organisationId: user.organisationId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException('Import job not found');
    }
    await this.tracking.alignToStatus(id, user.organisationId, existing.status as JobStatus);
    const job = await this.prisma.importJob.findFirst({
      where: { id, organisationId: user.organisationId },
      include: jobDetailInclude,
    });
    if (!job) {
      throw new NotFoundException('Import job not found');
    }
    return this.present(job);
  }

  async create(user: AuthUser, dto: CreateImportJobDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organisationId: user.organisationId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    let vehicleId = dto.vehicleId;
    if (vehicleId) {
      const existing = await this.prisma.vehicle.findFirst({
        where: { id: vehicleId, organisationId: user.organisationId },
      });
      if (!existing) {
        throw new NotFoundException('Vehicle not found');
      }
    } else {
      const vehicle = await this.prisma.vehicle.create({
        data: {
          organisationId: user.organisationId,
          vin: dto.vin,
          make: dto.make,
          model: dto.model,
          variant: dto.variant,
          year: dto.year,
          mileage: dto.mileage,
          fuelType: dto.fuelType,
          colour: dto.colour,
          engineSize: dto.engineSize,
          bodyType: dto.bodyType,
          countryOfRegistration: dto.countryOfRegistration ?? 'GB',
          ukRegistration: dto.ukRegistration,
          registrations: dto.ukRegistration
            ? {
                create: {
                  organisationId: user.organisationId,
                  kind: 'UK',
                  number: dto.ukRegistration,
                  country: dto.countryOfRegistration ?? 'GB',
                },
              }
            : undefined,
        },
      });
      vehicleId = vehicle.id;
    }

    const year = new Date().getFullYear();
    const prefix = `CY-${year}-`;
    const count = await this.prisma.importJob.count({
      where: { organisationId: user.organisationId, reference: { startsWith: prefix } },
    });
    const reference = `${prefix}${String(count + 1).padStart(5, '0')}`;

    const job = await this.prisma.importJob.create({
      data: {
        organisationId: user.organisationId,
        customerId: customer.id,
        vehicleId,
        reference,
        status: 'NEW',
        originCountry: dto.originCountry ?? 'GB',
        destinationCountry: dto.destinationCountry ?? 'CY',
        registrationCountry: dto.registrationCountry,
        expectedDeliveryDate: dto.expectedDeliveryDate
          ? new Date(dto.expectedDeliveryDate)
          : undefined,
        startedAt: new Date(),
        statusHistory: {
          create: {
            organisationId: user.organisationId,
            fromStatus: null,
            toStatus: 'NEW',
            changedById: user.id,
            note: 'Import job created',
          },
        },
      },
      include: jobDetailInclude,
    });
    void this.usage.incrementImportJobs(user.organisationId, job.createdAt);
    void this.audit.record(user, {
      action: 'JOB_CREATED',
      entityType: 'ImportJob',
      entityId: job.id,
      metadata: { importJobId: job.id, reference: job.reference },
    });
    return this.present(job);
  }

  async update(user: AuthUser, id: string, dto: UpdateImportJobDto) {
    await this.get(user, id);
    const job = await this.prisma.importJob.update({
      where: { id },
      data: {
        originCountry: dto.originCountry,
        destinationCountry: dto.destinationCountry,
        registrationCountry: dto.registrationCountry,
        expectedDeliveryDate:
          dto.expectedDeliveryDate === undefined
            ? undefined
            : dto.expectedDeliveryDate
              ? new Date(dto.expectedDeliveryDate)
              : null,
      },
      include: jobDetailInclude,
    });
    return this.present(job);
  }

  async changeStatus(user: AuthUser, id: string, dto: ChangeStatusDto) {
    const current = await this.get(user, id);
    const from = current.status as JobStatus;
    const to = dto.status;
    if (!JOB_STATUSES.includes(to)) {
      throw new BadRequestException('Unknown status');
    }
    const allowed = STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Cannot move from ${from} to ${to}`);
    }
    const lastHistory = await this.prisma.jobStatusHistory.findFirst({
      where: { importJobId: id },
      orderBy: { createdAt: 'desc' },
    });
    const createdAt = lastHistory
      ? new Date(Math.max(Date.now(), lastHistory.createdAt.getTime() + 60_000))
      : new Date();
    const job = await this.prisma.importJob.update({
      where: { id },
      data: {
        status: to,
        completedAt: to === 'COMPLETED' || to === 'CANCELLED' ? createdAt : null,
        statusHistory: {
          create: {
            organisationId: user.organisationId,
            fromStatus: from,
            toStatus: to,
            changedById: user.id,
            note: dto.note,
            createdAt,
          },
        },
      },
      include: jobDetailInclude,
    });
    void this.audit.record(user, {
      action: 'JOB_STATUS_CHANGED',
      entityType: 'ImportJob',
      entityId: id,
      metadata: { importJobId: id, from, to },
    });
    this.notifications.notify({
      type: 'JOB_STATUS',
      importJobId: id,
      customerId: current.customerId,
      message: `Your vehicle is now: ${getStatusLabel(to)}`,
    });
    await this.tracking.alignToStatus(id, user.organisationId, to);
    return this.get(user, id);
  }

  async addTask(user: AuthUser, jobId: string, dto: CreateTaskDto) {
    await this.get(user, jobId);
    return this.prisma.task.create({
      data: {
        organisationId: user.organisationId,
        importJobId: jobId,
        title: dto.title,
        description: dto.description,
        status: dto.status ?? 'TODO',
        priority: dto.priority ?? 'MEDIUM',
        assignedToId: dto.assignedToId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
      include: { assignedTo: { select: publicUserSelect } },
    });
  }

  async updateTask(user: AuthUser, jobId: string, taskId: string, dto: UpdateTaskDto) {
    await this.get(user, jobId);
    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        priority: dto.priority,
        assignedToId: dto.assignedToId,
        dueDate:
          dto.dueDate === undefined ? undefined : dto.dueDate ? new Date(dto.dueDate) : null,
        completedAt:
          dto.status === 'COMPLETED' ? new Date() : dto.status ? null : undefined,
      },
      include: { assignedTo: { select: publicUserSelect } },
    });
  }

  async addCost(user: AuthUser, jobId: string, dto: CreateCostDto) {
    await this.get(user, jobId);
    return this.prisma.cost.create({
      data: {
        organisationId: user.organisationId,
        importJobId: jobId,
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        currency: dto.currency ?? 'EUR',
        supplier: dto.supplier,
        invoiceReference: dto.invoiceReference,
        incurredOn: dto.incurredOn ? new Date(dto.incurredOn) : undefined,
      },
    });
  }

  async addCharge(user: AuthUser, jobId: string, dto: CreateChargeDto) {
    await this.get(user, jobId);
    return this.prisma.customerCharge.create({
      data: {
        organisationId: user.organisationId,
        importJobId: jobId,
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        currency: dto.currency ?? 'EUR',
        incurredOn: dto.incurredOn ? new Date(dto.incurredOn) : undefined,
      },
    });
  }

  async addNote(user: AuthUser, jobId: string, dto: CreateNoteDto) {
    const job = await this.get(user, jobId);
    const visibility = dto.visibility ?? 'INTERNAL';
    const note = await this.prisma.note.create({
      data: {
        organisationId: user.organisationId,
        importJobId: jobId,
        authorId: user.id,
        body: dto.body,
        visibility,
      },
      include: { author: { select: publicUserSelect } },
    });
    void this.audit.record(user, {
      action: 'JOB_NOTE_ADDED',
      entityType: 'Note',
      entityId: note.id,
      metadata: { importJobId: jobId, visibility },
    });
    if (visibility === 'CUSTOMER') {
      this.notifications.notify({
        type: 'CUSTOMER_NOTE',
        importJobId: jobId,
        customerId: job.customerId,
        message: dto.body,
      });
    }
    return note;
  }

  async addJourney(user: AuthUser, jobId: string, dto: CreateJourneyDto) {
    await this.get(user, jobId);
    return this.prisma.journey.create({
      data: {
        organisationId: user.organisationId,
        importJobId: jobId,
        type: dto.type ?? 'ROAD',
        origin: dto.origin,
        destination: dto.destination,
        status: dto.status ?? 'PLANNED',
        startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : undefined,
      },
    });
  }

  async addDocument(
    user: AuthUser,
    jobId: string,
    file: Express.Multer.File,
    customerVisible: boolean,
    type?: string,
  ) {
    const job = await this.get(user, jobId);
    const storageKey = await this.storage.save(file.buffer, file.originalname, {
      organisationId: user.organisationId,
      importJobId: jobId,
      kind: 'documents',
    });
    const document = await this.prisma.document.create({
      data: {
        organisationId: user.organisationId,
        importJobId: jobId,
        type: (type as never) ?? 'OTHER',
        name: file.originalname,
        mimeType: file.mimetype,
        storageKey,
        sizeBytes: file.size,
        uploadedById: user.id,
        customerVisible,
      },
    });
    void this.audit.record(user, {
      action: 'DOCUMENT_UPLOADED',
      entityType: 'Document',
      entityId: document.id,
      metadata: { importJobId: jobId, customerVisible, name: document.name },
    });
    if (customerVisible) {
      this.notifications.notify({
        type: 'FILE_SHARED',
        importJobId: jobId,
        customerId: job.customerId,
        message: `A document was shared: ${document.name}`,
      });
    }
    return this.withoutStorageKey(document);
  }

  async addPhoto(
    user: AuthUser,
    jobId: string,
    file: Express.Multer.File,
    customerVisible: boolean,
    category?: string,
  ) {
    const job = await this.get(user, jobId);
    const storageKey = await this.storage.save(file.buffer, file.originalname, {
      organisationId: user.organisationId,
      importJobId: jobId,
      kind: 'photos',
    });
    const photo = await this.prisma.photo.create({
      data: {
        organisationId: user.organisationId,
        importJobId: jobId,
        category: (category as never) ?? 'OTHER',
        filename: file.originalname,
        mimeType: file.mimetype,
        storageKey,
        sizeBytes: file.size,
        uploadedById: user.id,
        customerVisible,
      },
    });
    void this.audit.record(user, {
      action: 'PHOTO_UPLOADED',
      entityType: 'Photo',
      entityId: photo.id,
      metadata: { importJobId: jobId, customerVisible, filename: photo.filename },
    });
    if (customerVisible) {
      this.notifications.notify({
        type: 'FILE_SHARED',
        importJobId: jobId,
        customerId: job.customerId,
        message: `A photo was shared: ${photo.filename}`,
      });
    }
    return this.withoutStorageKey(photo);
  }

  async setFileVisibility(
    user: AuthUser,
    jobId: string,
    kind: 'document' | 'photo',
    fileId: string,
    customerVisible: boolean,
  ) {
    const job = await this.get(user, jobId);
    if (kind === 'document') {
      const existing = await this.prisma.document.findFirst({
        where: { id: fileId, importJobId: jobId, organisationId: user.organisationId },
      });
      if (!existing) {
        throw new NotFoundException('Document not found');
      }
      const document = await this.prisma.document.update({
        where: { id: fileId },
        data: { customerVisible },
      });
      this.recordVisibilityChange(user, jobId, job.customerId, 'Document', document.id, document.name, existing.customerVisible, customerVisible);
      return this.withoutStorageKey(document);
    }
    const existing = await this.prisma.photo.findFirst({
      where: { id: fileId, importJobId: jobId, organisationId: user.organisationId },
    });
    if (!existing) {
      throw new NotFoundException('Photo not found');
    }
    const photo = await this.prisma.photo.update({
      where: { id: fileId },
      data: { customerVisible },
    });
    this.recordVisibilityChange(user, jobId, job.customerId, 'Photo', photo.id, photo.filename, existing.customerVisible, customerVisible);
    return this.withoutStorageKey(photo);
  }

  async activity(user: AuthUser, jobId: string) {
    const exists = await this.prisma.importJob.findFirst({
      where: { id: jobId, organisationId: user.organisationId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Import job not found');
    }
    return this.audit.listForJob(user, jobId);
  }

  async readStoredFile(user: AuthUser, jobId: string, kind: 'document' | 'photo', fileId: string) {
    await this.get(user, jobId);
    if (kind === 'document') {
      const doc = await this.prisma.document.findFirst({
        where: { id: fileId, importJobId: jobId, organisationId: user.organisationId },
      });
      if (!doc) {
        throw new NotFoundException('Document not found');
      }
      return {
        buffer: await this.storage.read(doc.storageKey, user.organisationId),
        mimeType: doc.mimeType,
        name: doc.name,
      };
    }
    const photo = await this.prisma.photo.findFirst({
      where: { id: fileId, importJobId: jobId, organisationId: user.organisationId },
    });
    if (!photo) {
      throw new NotFoundException('Photo not found');
    }
    return {
      buffer: await this.storage.read(photo.storageKey, user.organisationId),
      mimeType: photo.mimeType,
      name: photo.filename,
    };
  }

  stageOf(status: string) {
    return getJobStage(status as JobStatus);
  }

  private present<
    T extends {
      costs: { amount: Prisma.Decimal }[];
      charges: { amount: Prisma.Decimal }[];
      documents?: Array<{ storageKey: string }>;
      photos?: Array<{ storageKey: string }>;
    },
  >(job: T) {
    const totalCost = job.costs.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalCharge = job.charges.reduce((sum, item) => sum + Number(item.amount), 0);
    const documents = job.documents?.map(({ storageKey: _storageKey, ...document }) => document);
    const photos = job.photos?.map(({ storageKey: _storageKey, ...photo }) => photo);
    return {
      ...job,
      documents,
      photos,
      totals: { totalCost, totalCharge, margin: totalCharge - totalCost },
    };
  }

  private withoutStorageKey<T extends { storageKey: string }>(record: T) {
    const { storageKey: _storageKey, ...rest } = record;
    return rest;
  }

  private recordVisibilityChange(
    user: AuthUser,
    importJobId: string,
    customerId: string | null,
    entityType: 'Document' | 'Photo',
    entityId: string,
    name: string,
    wasVisible: boolean,
    customerVisible: boolean,
  ) {
    void this.audit.record(user, {
      action: 'FILE_VISIBILITY_CHANGED',
      entityType,
      entityId,
      metadata: { importJobId, customerVisible, name },
    });
    if (customerVisible && !wasVisible) {
      this.notifications.notify({
        type: 'FILE_SHARED',
        importJobId,
        customerId,
        message: `A file was shared: ${name}`,
      });
    }
  }
}
