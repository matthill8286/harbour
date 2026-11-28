import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { accessLock } from '../prisma/locked-transaction';
import { StorageService } from '../integrations/storage.service';
import { FileDeliveryService } from '../integrations/file-delivery.service';
import type { AuthUser } from '../auth/auth.types';
import { applyErasure } from './apply-erasure';
import {
  buildErasurePlan,
  planFingerprint,
  type ErasurePlan,
} from './erasure-plan';
import {
  ErasureJournal,
  type RemovedFile,
  type ReviewKind,
} from './erasure-journal';
import { REMOVED_TEXT } from './erasure-rules';

/** A long history takes longer than Prisma's default five seconds. */
export const ERASURE_TRANSACTION = { maxWait: 10_000, timeout: 60_000 };

const REVIEW_REASONS: Record<ReviewKind, string> = {
  DOCUMENT: 'It is not clear whether this document must be kept.',
  PHOTO: 'This photo may be evidence that has to be kept.',
  COST: 'This cost record seems to name the customer.',
  CHARGE: 'This charge seems to name the customer.',
};

@Injectable()
export class CustomerErasureService {
  private readonly logger = new Logger(CustomerErasureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly delivery: FileDeliveryService,
    private readonly journal: ErasureJournal,
  ) {}

  /** What erasing this customer would do. It changes nothing. */
  async preview(user: AuthUser, customerId: string) {
    const plan = await this.requirePlan(
      this.prisma,
      user.organisationId,
      customerId,
    );
    return describePlan(plan);
  }

  /** Refuses early, before a two-factor code is used up. */
  async assertCanErase(
    user: AuthUser,
    customerId: string,
    confirmation: string,
  ) {
    const plan = await this.requirePlan(
      this.prisma,
      user.organisationId,
      customerId,
    );
    assertErasable(plan, confirmation);
  }

  /**
   * Erases one customer. The caller has proved who they are. The database
   * changes, the record of them and the journal line succeed together. Files go
   * afterwards, so a failed transaction loses none.
   */
  async erase(user: AuthUser, customerId: string, confirmation: string) {
    const organisationId = user.organisationId;
    const erasureId = randomUUID();
    const files = await this.prisma.$transaction(async (tx) => {
      await this.hold(tx, organisationId, customerId);
      const plan = await this.requirePlan(tx, organisationId, customerId);
      assertErasable(plan, confirmation);
      const now = new Date();
      const files = await this.filesToRemove(tx, plan);
      await applyErasure(tx, plan, now);
      await tx.customerErasure.create({
        data: {
          id: erasureId,
          organisationId,
          customerId,
          performedById: user.id,
          performedAt: now,
          summary: summary(plan),
          reviewItems: { create: reviewItems(plan) },
        },
      });
      // Counts and ids only.
      await tx.auditLog.create({
        data: {
          organisationId,
          actorId: user.id,
          action: 'CUSTOMER_ERASED',
          entityType: 'Customer',
          entityId: customerId,
          metadata: { customerId, ...summary(plan) },
        },
      });
      // Last: an erasure that cannot be journalled does not happen.
      await this.journal.append({
        type: 'erasure',
        erasureId,
        organisationId,
        customerId,
        performedById: user.id,
        at: now.toISOString(),
        files,
      });
      return files;
    }, ERASURE_TRANSACTION);
    const filesNotRemoved = await this.removeFiles(organisationId, files);
    return { ...(await this.status(user, customerId)), filesNotRemoved };
  }

  /** Whether a customer was erased, and what still waits for a decision. */
  async status(user: AuthUser, customerId: string) {
    const erasure = await this.prisma.customerErasure.findUnique({
      where: {
        organisationId_customerId: {
          organisationId: user.organisationId,
          customerId,
        },
      },
      include: { reviewItems: { orderBy: [{ kind: 'asc' }, { id: 'asc' }] } },
    });
    if (!erasure) return { erasedAt: null, reviewItems: [] };
    const jobs = await this.prisma.importJob.findMany({
      where: { organisationId: user.organisationId, customerId },
      select: { id: true, reference: true },
    });
    return {
      erasedAt: erasure.performedAt,
      reviewItems: erasure.reviewItems.map((item) => ({
        id: item.id,
        kind: item.kind as ReviewKind,
        reason: item.reason,
        importJobId: item.importJobId,
        jobReference:
          jobs.find((job) => job.id === item.importJobId)?.reference ?? null,
        decision: item.decision,
        decidedAt: item.decidedAt,
      })),
    };
  }

  /** An Admin's decision on one flagged record: keep it, or take it out. */
  async decide(
    user: AuthUser,
    customerId: string,
    itemId: string,
    decision: 'KEEP' | 'REMOVE',
  ) {
    const organisationId = user.organisationId;
    const files = await this.prisma.$transaction(async (tx) => {
      await this.hold(tx, organisationId, customerId);
      const item = await tx.erasureReviewItem.findFirst({
        where: { id: itemId, erasure: { organisationId, customerId } },
      });
      if (!item) throw new NotFoundException('That item was not found.');
      if (item.decision) {
        throw new ConflictException('That item has already been decided.');
      }
      const now = new Date();
      await tx.erasureReviewItem.update({
        where: { id: item.id },
        data: {
          decision: decision === 'KEEP' ? 'KEPT' : 'REMOVED',
          decidedById: user.id,
          decidedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          organisationId,
          actorId: user.id,
          action:
            decision === 'KEEP'
              ? 'ERASURE_REVIEW_KEPT'
              : 'ERASURE_REVIEW_REMOVED',
          entityType: 'Customer',
          entityId: customerId,
          metadata: { customerId, kind: item.kind, recordId: item.recordId },
        },
      });
      if (decision === 'KEEP') return [];
      const kind = item.kind as ReviewKind;
      const files = await removeRecord(tx, organisationId, kind, item.recordId);
      await this.journal.append({
        type: 'review-removal',
        erasureId: item.erasureId,
        organisationId,
        customerId,
        performedById: user.id,
        at: now.toISOString(),
        kind,
        recordId: item.recordId,
        files,
      });
      return files;
    }, ERASURE_TRANSACTION);
    const filesNotRemoved = await this.removeFiles(organisationId, files);
    return { ...(await this.status(user, customerId)), filesNotRemoved };
  }

  /** Deletes files and every copy of them. Returns how many could not go. */
  async removeFiles(organisationId: string, files: RemovedFile[]) {
    let failed = 0;
    for (const file of files) {
      try {
        await this.delivery.remove({
          organisationId,
          storageKey: file.key,
          mimeType: file.mimeType,
        });
      } catch (error) {
        failed += 1;
        // The journal names it, so `erasures apply` can try again.
        this.logger.error(`Could not delete ${file.key}`, error as Error);
      }
    }
    return failed;
  }

  /** One change at a time, and no job of theirs added or reopened meanwhile. */
  async hold(
    tx: Prisma.TransactionClient,
    organisationId: string,
    customerId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accessLock(organisationId)}))`;
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "ImportJob" WHERE "customerId" = ${customerId} FOR UPDATE`;
  }

  /**
   * The files the rules remove, and any left in the job folders with no record:
   * what remains of an upload that failed or was deleted.
   */
  private async filesToRemove(
    tx: Prisma.TransactionClient,
    plan: ErasurePlan,
  ): Promise<RemovedFile[]> {
    const organisationId = plan.customer.organisationId;
    const removed = plan.files
      .filter((file) => file.disposition === 'REMOVE')
      .map((file) => ({ key: file.storageKey, mimeType: file.mimeType }));
    const known = plan.files.map((file) => file.storageKey);
    for (const job of plan.jobs) {
      for (const key of await this.storage.listJobFiles(
        organisationId,
        job.id,
      )) {
        // A copy's key is its original's key with a suffix.
        if (known.some((original) => key.startsWith(original))) continue;
        const recorded =
          (await tx.document.count({ where: { storageKey: key } })) +
          (await tx.photo.count({ where: { storageKey: key } }));
        if (!recorded) {
          removed.push({ key, mimeType: 'application/octet-stream' });
        }
      }
    }
    return removed;
  }

  private async requirePlan(
    db: Prisma.TransactionClient,
    organisationId: string,
    customerId: string,
  ) {
    const plan = await buildErasurePlan(db, organisationId, customerId);
    if (!plan) throw new NotFoundException('Customer not found');
    return plan;
  }
}

function assertErasable(plan: ErasurePlan, confirmation: string) {
  if (plan.customer.erasedAt) {
    throw new ConflictException('This customer has already been erased.');
  }
  if (plan.openJobs.length > 0) {
    throw new ConflictException(
      `This customer has an open job (${plan.openJobs
        .map((job) => job.reference)
        .join(', ')}). Complete or cancel it first.`,
    );
  }
  if (confirmation !== planFingerprint(plan)) {
    throw new BadRequestException({
      message:
        'This customer’s records changed since the preview. Look at the new preview, then try again.',
      code: 'erasure_preview_changed',
    });
  }
}

const count = (plan: ErasurePlan, disposition: string, kind: string) =>
  plan.files.filter(
    (file) => file.disposition === disposition && file.kind === kind,
  ).length;

/** Numbers only, so it can sit in the audit log. */
function summary(plan: ErasurePlan) {
  return {
    jobsKept: plan.jobs.length,
    notesRemoved: plan.noteIds.length,
    gpsPointsRemoved: plan.gpsPoints,
    documentsRemoved: count(plan, 'REMOVE', 'DOCUMENT'),
    photosRemoved: count(plan, 'REMOVE', 'PHOTO'),
    filesRetained: plan.files.filter((file) => file.disposition === 'RETAIN')
      .length,
    flaggedForReview: reviewItems(plan).length,
  };
}

function reviewItems(plan: ErasurePlan) {
  return [
    ...plan.files.filter((file) => file.disposition === 'REVIEW'),
    ...plan.flaggedMoney,
  ].map((item) => ({
    kind: item.kind,
    recordId: item.id,
    importJobId: item.importJobId,
    reason: REVIEW_REASONS[item.kind],
  }));
}

/**
 * The preview. It says nothing about whether a sign-in account is used anywhere
 * else, because that is not this workspace's to know.
 */
function describePlan(plan: ErasurePlan) {
  const { customer } = plan;
  const totals = summary(plan);
  return {
    alreadyErased: Boolean(customer.erasedAt),
    openJobs: plan.openJobs.map(({ id, reference, status }) => ({
      id,
      reference,
      status,
    })),
    remove: {
      contactDetails: [customer.email, customer.phone, customer.address].filter(
        Boolean,
      ).length,
      internalCustomerNotes: customer.notes ? 1 : 0,
      notes: totals.notesRemoved,
      gpsPoints: totals.gpsPointsRemoved,
      documents: totals.documentsRemoved,
      photos: totals.photosRemoved,
      portalAccess: plan.membershipCount,
      portalInvites: plan.inviteCount,
    },
    anonymise: {
      tasks: plan.taskCount,
      journeys: plan.journeyCount,
      statusNotes: plan.statusNoteCount,
      auditEntries: plan.auditEntries,
    },
    keep: {
      jobs: plan.jobs.length,
      vehicles: plan.vehicleCount,
      files: totals.filesRetained,
      costs: plan.costCount,
      charges: plan.chargeCount,
    },
    review: reviewItems(plan).map((item) => ({
      kind: item.kind,
      reason: item.reason,
      jobReference:
        plan.jobs.find((job) => job.id === item.importJobId)?.reference ?? null,
    })),
    confirmation: planFingerprint(plan),
  };
}

/** Takes a flagged record out. Returns the files to delete once that is saved. */
export async function removeRecord(
  tx: Prisma.TransactionClient,
  organisationId: string,
  kind: ReviewKind,
  recordId: string,
): Promise<RemovedFile[]> {
  const where = { id: recordId, organisationId };
  if (kind === 'COST') {
    // The amount, date and invoice number stay, for the accounts.
    await tx.cost.updateMany({
      where,
      data: { description: REMOVED_TEXT, supplier: null },
    });
    return [];
  }
  if (kind === 'CHARGE') {
    await tx.customerCharge.updateMany({
      where,
      data: { description: REMOVED_TEXT },
    });
    return [];
  }
  const file =
    kind === 'DOCUMENT'
      ? await tx.document.findFirst({ where })
      : await tx.photo.findFirst({ where });
  if (!file) return [];
  if (kind === 'DOCUMENT') await tx.document.deleteMany({ where });
  else await tx.photo.deleteMany({ where });
  return [{ key: file.storageKey, mimeType: file.mimeType }];
}
