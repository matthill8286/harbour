import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  firstStatus,
  getJobStage,
  moveProblem,
  moneyLineProblem,
  RETIRED_ROLES,
  STAFF_ROLES,
  statusLabel,
  type JobStatus,
  type MoneyLineKind,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../integrations/storage.service';
import { NotificationsService } from '../integrations/notifications.service';
import { AuditService } from '../audit/audit.service';
import { TrackingService } from '../tracking/tracking.service';
import { UsageService } from '../tenancy/usage.service';
import { RouteTemplatesService } from '../routes/route-templates.service';
import {
  toWorkflow,
  WorkflowRoutesService,
  type RouteRow,
} from '../workflow/workflow-routes.service';
import { AiTransport } from '../integrations/ai-transport';
import { jobReferencePrefix } from './job-reference';
import {
  buildCustomerNoteDraft,
  vehicleSummaryFromParts,
} from './customer-note-draft';
import {
  pickValidatedRecommendation,
  recommendCorridorHeuristic,
  type CorridorRecommendation,
  type CorridorTemplateInput,
} from '../routes/corridor-recommend';
import type { AuthUser } from '../auth/auth.types';
import {
  ChangeStatusDto,
  CreateChargeDto,
  CreateCostDto,
  CreateImportJobDto,
  CreateJourneyDto,
  CreateNoteDto,
  CreateTaskDto,
  DraftCustomerNoteDto,
  UpdateChargeDto,
  UpdateCostDto,
  UpdateImportJobDto,
  UpdateTaskDto,
} from './dto/import-job.dto';

/** Creations in one workspace queue for the next reference, so allow longer than Prisma's defaults. */
const jobWriteTransaction = { maxWait: 10_000, timeout: 15_000 };

/** A route loaded with its stages, as the detail view includes it, rather than the list's summary. */
const isFullRoute = (value: unknown): value is RouteRow =>
  typeof value === 'object' && value !== null && 'stages' in value;

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
} satisfies Prisma.UserSelect;

/** Stored roles that count as staff. A retired role is read as the role that replaced it. */
const storedStaffRoles = [
  ...STAFF_ROLES,
  ...(Object.keys(RETIRED_ROLES) as Array<keyof typeof RETIRED_ROLES>),
];

const jobListInclude = {
  customer: true,
  route: { select: { id: true, name: true, shortLabel: true } },
  vehicle: true,
  _count: { select: { tasks: true, documents: true, photos: true } },
} satisfies Prisma.ImportJobInclude;

const jobDetailInclude = {
  customer: true,
  route: {
    include: {
      stages: {
        orderBy: { sortOrder: 'asc' },
        include: { statuses: { orderBy: { sortOrder: 'asc' } } },
      },
    },
  },
  vehicle: { include: { registrations: true } },
  routeTemplate: true,
  statusHistory: {
    include: { changedBy: { select: publicUserSelect } },
    orderBy: { createdAt: 'asc' },
  },
  journeys: { orderBy: { createdAt: 'asc' } },
  tasks: {
    include: { assignedTo: { select: publicUserSelect } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  costs: { orderBy: { incurredOn: 'desc' } },
  charges: { orderBy: { incurredOn: 'desc' } },
  notes: {
    include: { author: { select: publicUserSelect } },
    orderBy: { createdAt: 'desc' },
  },
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
    private readonly routes: RouteTemplatesService,
    private readonly workflows: WorkflowRoutesService,
    private readonly ai: AiTransport,
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
                {
                  customer: {
                    firstName: { contains: query.search, mode: 'insensitive' },
                  },
                },
                {
                  customer: {
                    lastName: { contains: query.search, mode: 'insensitive' },
                  },
                },
                {
                  vehicle: {
                    make: { contains: query.search, mode: 'insensitive' },
                  },
                },
                {
                  vehicle: {
                    model: { contains: query.search, mode: 'insensitive' },
                  },
                },
                {
                  vehicle: {
                    ukRegistration: {
                      contains: query.search,
                      mode: 'insensitive',
                    },
                  },
                },
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
    await this.tracking.alignToStatus(
      id,
      user.organisationId,
      existing.status as JobStatus,
    );
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

    if (dto.vehicleId) {
      const existing = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, organisationId: user.organisationId },
      });
      if (!existing) {
        throw new NotFoundException('Vehicle not found');
      }
    }

    const route = await this.workflows.routeForNewJob(
      user.organisationId,
      dto.routeId,
    );
    const startStatus = firstStatus(route);
    if (!startStatus) {
      throw new BadRequestException(`${route.name} has no statuses yet.`);
    }
    const routeTemplateId = await this.routes.defaultTemplateId();
    const destinationCountry =
      dto.destinationCountry ?? route.destinationCountry;

    const job = await this.prisma.$transaction(async (tx) => {
      await this.workflows.holdStatus(
        tx,
        user.organisationId,
        route.id,
        startStatus,
      );
      const reference = await this.nextReference(
        tx,
        user.organisationId,
        jobReferencePrefix(destinationCountry, user.organisationCountry),
      );
      const vehicleId =
        dto.vehicleId || (await this.createVehicle(tx, user, dto)).id;
      const created = await tx.importJob.create({
        data: {
          organisationId: user.organisationId,
          customerId: customer.id,
          vehicleId,
          reference,
          routeId: route.id,
          status: startStatus,
          originCountry: dto.originCountry ?? route.originCountry,
          destinationCountry,
          registrationCountry: dto.registrationCountry,
          routeTemplateId: routeTemplateId ?? undefined,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : undefined,
          startedAt: new Date(),
          statusHistory: {
            create: {
              organisationId: user.organisationId,
              fromStatus: null,
              toStatus: startStatus,
              changedById: user.id,
              note: 'Import job created',
            },
          },
        },
        include: jobDetailInclude,
      });
      await this.usage.incrementImportJobs(
        user.organisationId,
        created.createdAt,
        tx,
      );
      return created;
    }, jobWriteTransaction);
    void this.audit.record(user, {
      action: 'JOB_CREATED',
      entityType: 'ImportJob',
      entityId: job.id,
      metadata: { importJobId: job.id, reference: job.reference },
    });
    return this.present(job);
  }

  /**
   * The workspace's next job reference for this country and year: one more than
   * the highest so far. The lock lasts until the transaction ends, so a second creation
   * waits and then sees this job.
   */
  private async nextReference(
    tx: Prisma.TransactionClient,
    organisationId: string,
    country: string,
  ) {
    const prefix = `${country}-${new Date().getFullYear()}-`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-reference:${organisationId}`}))`;
    const [{ highest }] = await tx.$queryRaw<[{ highest: bigint | null }]>`
      SELECT max(substring("reference" from '[0-9]+$')::bigint) AS highest
      FROM "ImportJob"
      WHERE "organisationId" = ${organisationId}
        AND "reference" ~ ${`^${prefix}[0-9]{1,15}$`}
    `;
    return `${prefix}${String(Number(highest ?? 0) + 1).padStart(5, '0')}`;
  }

  private createVehicle(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    dto: CreateImportJobDto,
  ) {
    return tx.vehicle.create({
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
  }

  async update(user: AuthUser, id: string, dto: UpdateImportJobDto) {
    await this.get(user, id);
    let routeTemplateId: string | null | undefined = undefined;
    if (dto.routeTemplateId !== undefined) {
      if (dto.routeTemplateId === null || dto.routeTemplateId === '') {
        routeTemplateId = null;
      } else {
        await this.routes.requireAssignable(user, dto.routeTemplateId);
        routeTemplateId = dto.routeTemplateId;
      }
    }
    const job = await this.prisma.importJob.update({
      where: { id },
      data: {
        originCountry: dto.originCountry,
        destinationCountry: dto.destinationCountry,
        registrationCountry: dto.registrationCountry,
        routeTemplateId,
        expectedDeliveryDate:
          dto.expectedDeliveryDate === undefined
            ? undefined
            : dto.expectedDeliveryDate
              ? new Date(dto.expectedDeliveryDate)
              : null,
      },
      include: jobDetailInclude,
    });
    if (routeTemplateId !== undefined) {
      void this.audit.record(user, {
        action: 'JOB_ROUTE_TEMPLATE_CHANGED',
        entityType: 'ImportJob',
        entityId: id,
        metadata: { importJobId: id, routeTemplateId },
      });
    }
    return this.present(job);
  }

  /**
   * Staff-only corridor suggestion. Never auto-assigns — apply via PATCH.
   * Offline heuristics always work; OpenAI optional when keyed.
   */
  async recommendRoute(
    user: AuthUser,
    id: string,
  ): Promise<CorridorRecommendation> {
    const job = await this.prisma.importJob.findFirst({
      where: { id, organisationId: user.organisationId },
      select: {
        id: true,
        status: true,
        routeTemplateId: true,
        routeTemplate: {
          select: { id: true, code: true, name: true, waypoints: true },
        },
        locationEvents: {
          orderBy: { recordedAt: 'desc' },
          take: 1,
          select: { latitude: true, longitude: true },
        },
      },
    });
    if (!job) {
      throw new NotFoundException('Import job not found');
    }

    const listed = await this.routes.list(user);
    const templates: CorridorTemplateInput[] = listed.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      waypoints: t.waypoints.map((w) => ({
        latitude: w.latitude,
        longitude: w.longitude,
      })),
    }));
    if (templates.length === 0) {
      throw new BadRequestException('No route templates available');
    }

    const lastEvent = job.locationEvents[0];
    const lastPing = lastEvent
      ? {
          latitude: Number(lastEvent.latitude),
          longitude: Number(lastEvent.longitude),
        }
      : null;
    const heuristic = recommendCorridorHeuristic({
      templates,
      currentTemplateId: job.routeTemplateId,
      lastPing,
      status: job.status,
    });

    const modelPick = await this.ai.completeJson<{
      recommendedTemplateId?: string;
      rationale?: string;
      confidence?: number;
    }>({
      system:
        'You are Harbour ops assist. Recommend one UK→BG→GR corridor template for a vehicle import job. Use only the provided template ids. Staff will confirm before applying. Never invent GPS positions. Never draft customer emails.',
      user: JSON.stringify({
        status: job.status,
        currentTemplateId: job.routeTemplateId,
        currentTemplate: job.routeTemplate
          ? {
              id: job.routeTemplate.id,
              code: job.routeTemplate.code,
              name: job.routeTemplate.name,
            }
          : null,
        lastPing,
        templates: templates.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          waypointCount: t.waypoints.length,
          sampleWaypoints: t.waypoints.slice(0, 4),
        })),
      }),
      schemaHint:
        '{ "recommendedTemplateId": string, "rationale": string, "confidence": number }',
      logFallback: {
        recommendedTemplateId: heuristic.recommendedTemplateId,
        rationale: heuristic.rationale,
        confidence: heuristic.confidence,
      },
    });

    return (
      pickValidatedRecommendation(
        templates,
        modelPick.recommendedTemplateId,
        modelPick.rationale,
        modelPick.confidence,
      ) ?? heuristic
    );
  }

  async changeStatus(user: AuthUser, id: string, dto: ChangeStatusDto) {
    const current = await this.get(user, id);
    const from = current.status;
    const to = dto.status;
    const route = await this.workflows.workflowFor(
      user.organisationId,
      current.routeId,
    );
    const problem = moveProblem(route, from, to);
    if (problem) {
      throw new BadRequestException(problem);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.workflows.holdStatus(tx, user.organisationId, route.id, to);
      // Moves the job only if nobody has moved it since it was read. This also
      // locks the job until the history line is written.
      const moved = await tx.importJob.updateMany({
        where: { id, organisationId: user.organisationId, status: from },
        data: { status: to },
      });
      if (!moved.count) {
        throw new ConflictException(
          'This job’s status has just changed. Reload it and try again.',
        );
      }
      const lastHistory = await tx.jobStatusHistory.findFirst({
        where: { importJobId: id },
        orderBy: { createdAt: 'desc' },
      });
      const createdAt = lastHistory
        ? new Date(
            Math.max(Date.now(), lastHistory.createdAt.getTime() + 60_000),
          )
        : new Date();
      await tx.importJob.update({
        where: { id },
        data: {
          completedAt:
            to === 'COMPLETED' || to === 'CANCELLED' ? createdAt : null,
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
      });
    }, jobWriteTransaction);
    void this.audit.record(user, {
      action: 'JOB_STATUS_CHANGED',
      entityType: 'ImportJob',
      entityId: id,
      metadata: { importJobId: id, from, to },
    });
    this.notifications.notify({
      type: 'JOB_STATUS',
      organisationId: user.organisationId,
      importJobId: id,
      customerId: current.customerId,
      message: `Your vehicle is now: ${statusLabel(route, to)}`,
    });
    await this.tracking.alignToStatus(id, user.organisationId, to as JobStatus);
    return this.get(user, id);
  }

  async addTask(user: AuthUser, jobId: string, dto: CreateTaskDto) {
    await this.get(user, jobId);
    await this.requireAssignee(user, dto.assignedToId);
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

  async updateTask(
    user: AuthUser,
    jobId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ) {
    await this.get(user, jobId);
    const where = {
      id: taskId,
      importJobId: jobId,
      organisationId: user.organisationId,
    };
    const task = await this.prisma.task.findFirst({
      where,
      select: { id: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    await this.requireAssignee(user, dto.assignedToId);
    return this.prisma.task.update({
      where,
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        priority: dto.priority,
        assignedToId: dto.assignedToId,
        dueDate:
          dto.dueDate === undefined
            ? undefined
            : dto.dueDate
              ? new Date(dto.dueDate)
              : null,
        completedAt:
          dto.status === 'COMPLETED'
            ? new Date()
            : dto.status
              ? null
              : undefined,
      },
      include: { assignedTo: { select: publicUserSelect } },
    });
  }

  /** A task can only go to someone who is on this workspace's staff now. Null leaves it unassigned. */
  private async requireAssignee(user: AuthUser, assignedToId?: string | null) {
    if (assignedToId === undefined || assignedToId === null) return;
    const member = await this.prisma.organisationMembership.findFirst({
      where: {
        organisationId: user.organisationId,
        userId: assignedToId,
        status: 'ACTIVE',
        role: { in: storedStaffRoles },
      },
      select: { id: true },
    });
    if (!member) {
      throw new BadRequestException(
        'Tasks can only be assigned to an active member of your team.',
      );
    }
  }

  /** Refuse a money line that breaks the shared rule, with the rule's own words. */
  private checkMoneyLine(line: {
    category: string;
    description?: string | null;
    amount: number;
  }) {
    const problem = moneyLineProblem(line);
    if (problem) throw new BadRequestException(problem);
  }

  /**
   * Write a money change to the job's Activity. Costs, charges and margin are
   * internal, so the entry is only ever read by staff.
   */
  private recordMoneyLine(
    user: AuthUser,
    action: 'MONEY_LINE_ADDED' | 'MONEY_LINE_UPDATED' | 'MONEY_LINE_DELETED',
    jobId: string,
    kind: MoneyLineKind,
    line: {
      id: string;
      category: string;
      description: string;
      amount: Prisma.Decimal | number;
    },
    before?: {
      category: string;
      description: string;
      amount: Prisma.Decimal | number;
    },
  ) {
    void this.audit.record(user, {
      action,
      entityType: kind === 'cost' ? 'Cost' : 'CustomerCharge',
      entityId: line.id,
      metadata: {
        importJobId: jobId,
        kind,
        category: line.category,
        description: line.description,
        amount: Number(line.amount),
        ...(before
          ? {
              before: {
                category: before.category,
                description: before.description,
                amount: Number(before.amount),
              },
            }
          : {}),
      },
    });
  }

  async addCost(user: AuthUser, jobId: string, dto: CreateCostDto) {
    await this.get(user, jobId);
    this.checkMoneyLine(dto);
    const cost = await this.prisma.cost.create({
      data: {
        organisationId: user.organisationId,
        importJobId: jobId,
        category: dto.category,
        description: dto.description?.trim() ?? '',
        amount: dto.amount,
        currency: dto.currency ?? 'EUR',
        supplier: dto.supplier,
        invoiceReference: dto.invoiceReference,
        incurredOn: dto.incurredOn ? new Date(dto.incurredOn) : undefined,
      },
    });
    this.recordMoneyLine(user, 'MONEY_LINE_ADDED', jobId, 'cost', cost);
    return cost;
  }

  async addCharge(user: AuthUser, jobId: string, dto: CreateChargeDto) {
    await this.get(user, jobId);
    this.checkMoneyLine(dto);
    const charge = await this.prisma.customerCharge.create({
      data: {
        organisationId: user.organisationId,
        importJobId: jobId,
        category: dto.category,
        description: dto.description?.trim() ?? '',
        amount: dto.amount,
        currency: dto.currency ?? 'EUR',
        incurredOn: dto.incurredOn ? new Date(dto.incurredOn) : undefined,
      },
    });
    this.recordMoneyLine(user, 'MONEY_LINE_ADDED', jobId, 'charge', charge);
    return charge;
  }

  /** Edit a cost line. Allowed on a closed job too, so the books can be corrected after delivery. */
  async updateCost(
    user: AuthUser,
    jobId: string,
    costId: string,
    dto: UpdateCostDto,
  ) {
    const before = await this.prisma.cost.findFirst({
      where: {
        id: costId,
        importJobId: jobId,
        organisationId: user.organisationId,
      },
    });
    if (!before) throw new NotFoundException('Cost line not found');
    const next = {
      category: dto.category ?? before.category,
      description:
        dto.description !== undefined
          ? dto.description.trim()
          : before.description,
      amount: dto.amount ?? Number(before.amount),
    };
    this.checkMoneyLine(next);
    const cost = await this.prisma.cost.update({
      where: { id: costId },
      data: next,
    });
    this.recordMoneyLine(
      user,
      'MONEY_LINE_UPDATED',
      jobId,
      'cost',
      cost,
      before,
    );
    return cost;
  }

  /** Edit a charge line. Allowed on a closed job too. */
  async updateCharge(
    user: AuthUser,
    jobId: string,
    chargeId: string,
    dto: UpdateChargeDto,
  ) {
    const before = await this.prisma.customerCharge.findFirst({
      where: {
        id: chargeId,
        importJobId: jobId,
        organisationId: user.organisationId,
      },
    });
    if (!before) throw new NotFoundException('Charge line not found');
    const next = {
      category: dto.category ?? before.category,
      description:
        dto.description !== undefined
          ? dto.description.trim()
          : before.description,
      amount: dto.amount ?? Number(before.amount),
    };
    this.checkMoneyLine(next);
    const charge = await this.prisma.customerCharge.update({
      where: { id: chargeId },
      data: next,
    });
    this.recordMoneyLine(
      user,
      'MONEY_LINE_UPDATED',
      jobId,
      'charge',
      charge,
      before,
    );
    return charge;
  }

  async deleteCost(user: AuthUser, jobId: string, costId: string) {
    const cost = await this.prisma.cost.findFirst({
      where: {
        id: costId,
        importJobId: jobId,
        organisationId: user.organisationId,
      },
    });
    if (!cost) throw new NotFoundException('Cost line not found');
    await this.prisma.cost.delete({ where: { id: costId } });
    this.recordMoneyLine(user, 'MONEY_LINE_DELETED', jobId, 'cost', cost);
    return { deleted: true };
  }

  async deleteCharge(user: AuthUser, jobId: string, chargeId: string) {
    const charge = await this.prisma.customerCharge.findFirst({
      where: {
        id: chargeId,
        importJobId: jobId,
        organisationId: user.organisationId,
      },
    });
    if (!charge) throw new NotFoundException('Charge line not found');
    await this.prisma.customerCharge.delete({ where: { id: chargeId } });
    this.recordMoneyLine(user, 'MONEY_LINE_DELETED', jobId, 'charge', charge);
    return { deleted: true };
  }

  /**
   * Staff-only draft for a customer-visible note. Never posts or emails —
   * staff must still save the note themselves.
   */
  async draftCustomerNote(
    user: AuthUser,
    jobId: string,
    dto: DraftCustomerNoteDto,
  ) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, organisationId: user.organisationId },
      select: {
        reference: true,
        status: true,
        routeId: true,
        vehicle: {
          select: {
            make: true,
            model: true,
            variant: true,
            ukRegistration: true,
          },
        },
      },
    });
    if (!job) {
      throw new NotFoundException('Import job not found');
    }

    const route = await this.workflows.workflowFor(
      user.organisationId,
      job.routeId,
    );
    const currentLabel = statusLabel(route, job.status);
    const vehicleSummary = vehicleSummaryFromParts(job.vehicle ?? {});
    const logDraft = buildCustomerNoteDraft({
      reference: job.reference,
      statusLabel: currentLabel,
      vehicleSummary,
      intent: dto.intent,
      tone: dto.tone,
    });

    const result = await this.ai.completeText({
      system:
        'You write short, professional customer updates for Harbour vehicle imports. Use only the facts provided. Never invent costs, margins, prices, IMEI, tracker ids, internal notes, or delivery promises you were not given. Do not mention internal ops tooling. Plain text only — no markdown headings.',
      user: JSON.stringify({
        intent: dto.intent.trim(),
        tone: dto.tone?.trim() || 'professional',
        reference: job.reference,
        statusLabel: currentLabel,
        vehicleSummary: vehicleSummary || null,
      }),
      logFallback: logDraft,
    });

    return { draft: result.text, source: result.source };
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
        organisationId: user.organisationId,
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
        organisationId: user.organisationId,
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
      metadata: {
        importJobId: jobId,
        customerVisible,
        filename: photo.filename,
      },
    });
    if (customerVisible) {
      this.notifications.notify({
        type: 'FILE_SHARED',
        organisationId: user.organisationId,
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
        where: {
          id: fileId,
          importJobId: jobId,
          organisationId: user.organisationId,
        },
      });
      if (!existing) {
        throw new NotFoundException('Document not found');
      }
      const document = await this.prisma.document.update({
        where: { id: fileId },
        data: { customerVisible },
      });
      this.recordVisibilityChange(
        user,
        jobId,
        job.customerId,
        'Document',
        document.id,
        document.name,
        existing.customerVisible,
        customerVisible,
      );
      return this.withoutStorageKey(document);
    }
    const existing = await this.prisma.photo.findFirst({
      where: {
        id: fileId,
        importJobId: jobId,
        organisationId: user.organisationId,
      },
    });
    if (!existing) {
      throw new NotFoundException('Photo not found');
    }
    const photo = await this.prisma.photo.update({
      where: { id: fileId },
      data: { customerVisible },
    });
    this.recordVisibilityChange(
      user,
      jobId,
      job.customerId,
      'Photo',
      photo.id,
      photo.filename,
      existing.customerVisible,
      customerVisible,
    );
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

  async readStoredFile(
    user: AuthUser,
    jobId: string,
    kind: 'document' | 'photo',
    fileId: string,
  ) {
    await this.get(user, jobId);
    if (kind === 'document') {
      const doc = await this.prisma.document.findFirst({
        where: {
          id: fileId,
          importJobId: jobId,
          organisationId: user.organisationId,
        },
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
      where: {
        id: fileId,
        importJobId: jobId,
        organisationId: user.organisationId,
      },
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
    const totalCost = job.costs.reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );
    const totalCharge = job.charges.reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );
    const documents = job.documents?.map((document) =>
      this.withoutStorageKey(document),
    );
    const photos = job.photos?.map((photo) => this.withoutStorageKey(photo));
    const routeTemplate =
      'routeTemplate' in job && job.routeTemplate
        ? this.routes.present(
            job.routeTemplate as {
              id: string;
              code: string;
              name: string;
              description: string | null;
              waypoints: unknown;
              sortOrder: number;
            },
          )
        : 'routeTemplate' in job
          ? null
          : undefined;
    // The detail view carries the whole route, so the web app shows the same moves the API allows.
    const route =
      'route' in job && isFullRoute(job.route)
        ? toWorkflow(job.route)
        : undefined;
    return {
      ...job,
      ...(route ? { route } : {}),
      ...(routeTemplate !== undefined ? { routeTemplate } : {}),
      documents,
      photos,
      totals: { totalCost, totalCharge, margin: totalCharge - totalCost },
    };
  }

  private withoutStorageKey<T extends { storageKey: string }>(record: T) {
    const { storageKey, ...rest } = record;
    void storageKey;
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
        organisationId: user.organisationId,
        importJobId,
        customerId,
        message: `A file was shared: ${name}`,
      });
    }
  }
}
