/**
 * The end of a workspace's contract. The operator schedules it, the workspace
 * keeps working through a notice period so its Admins can export everything,
 * and once the notice has passed the operator deletes the workspace's data.
 * Like the rest of the operator's commands, nothing here has an HTTP route.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { eraseAccountIfOnlyOurs } from '../privacy/apply-erasure';
import type { WorkspaceDeletionEntry } from '../privacy/erasure-journal';
import {
  OperatorError,
  requireOperator,
  requireReason,
  requireWorkspace,
} from './workspace-access';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Days between the end of the contract and the deletion, unless
 * WORKSPACE_DELETION_NOTICE_DAYS says otherwise. A placeholder until the
 * contract sets the period.
 */
export const DEFAULT_DELETION_NOTICE_DAYS = 30;

/** Deleting a large workspace takes a while. */
const DELETION_TRANSACTION = { maxWait: 10_000, timeout: 10 * 60_000 };

export function deletionNoticeDays(
  value = process.env.WORKSPACE_DELETION_NOTICE_DAYS,
): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_DELETION_NOTICE_DAYS;
  }
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1) {
    throw new OperatorError(
      'WORKSPACE_DELETION_NOTICE_DAYS must be a whole number of days, 1 or more.',
    );
  }
  return days;
}

/** A date such as 2027-01-31, read as the end of that day in UTC. */
export function parseContractEnd(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OperatorError('Give the contract end as YYYY-MM-DD.');
  }
  const date = new Date(`${value}T23:59:59.999Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new OperatorError('Give the contract end as YYYY-MM-DD.');
  }
  return date;
}

type Schedule = {
  slug: string;
  operatorEmail: string;
  reason: string;
  contractEndsAt: Date;
  noticeDays: number;
};

/**
 * Records that the workspace's contract ends, and when its data may be deleted.
 * It changes nothing else: the workspace keeps working until it is deleted.
 */
export function scheduleClosure(
  prisma: PrismaClient,
  change: Schedule,
  now = new Date(),
) {
  const reason = requireReason(change.reason);
  const deleteAfter = new Date(
    change.contractEndsAt.getTime() + change.noticeDays * DAY,
  );
  return prisma.$transaction(async (tx) => {
    const operator = await requireOperator(tx, change.operatorEmail);
    const organisation = await requireWorkspace(tx, change.slug);
    const existing = await tx.workspaceClosure.findUnique({
      where: { organisationId: organisation.id },
    });
    if (existing) {
      throw new OperatorError(
        `${change.slug} is already due for deletion after ${existing.deleteAfter.toISOString()}. Cancel that first to change it.`,
      );
    }
    await tx.workspaceClosure.create({
      data: {
        organisationId: organisation.id,
        contractEndsAt: change.contractEndsAt,
        deleteAfter,
        reason,
        scheduledById: operator.id,
        scheduledAt: now,
      },
    });
    await record(
      tx,
      'WORKSPACE_CLOSURE_SCHEDULED',
      operator.id,
      organisation.id,
      reason,
      {
        contractEndsAt: change.contractEndsAt.toISOString(),
        deleteAfter: deleteAfter.toISOString(),
      },
    );
    return { organisation, deleteAfter };
  });
}

export function cancelClosure(
  prisma: PrismaClient,
  change: { slug: string; operatorEmail: string; reason: string },
) {
  const reason = requireReason(change.reason);
  return prisma.$transaction(async (tx) => {
    const operator = await requireOperator(tx, change.operatorEmail);
    const organisation = await requireWorkspace(tx, change.slug);
    const { count } = await tx.workspaceClosure.deleteMany({
      where: { organisationId: organisation.id },
    });
    if (count !== 1) {
      throw new OperatorError(`${change.slug} is not due for deletion.`);
    }
    await record(
      tx,
      'WORKSPACE_CLOSURE_CANCELLED',
      operator.id,
      organisation.id,
      reason,
    );
    return organisation;
  });
}

/** What deleting the workspace would remove, as counts. */
export async function deletionSummary(
  db: Prisma.TransactionClient | PrismaClient,
  organisationId: string,
) {
  const where = { organisationId };
  const [
    members,
    customers,
    jobs,
    vehicles,
    trackers,
    positions,
    documents,
    photos,
  ] = await Promise.all([
    db.organisationMembership.count({ where }),
    db.customer.count({ where }),
    db.importJob.count({ where }),
    db.vehicle.count({ where }),
    db.tracker.count({ where }),
    db.locationEvent.count({ where }),
    db.document.count({ where }),
    db.photo.count({ where }),
  ]);
  return {
    members,
    customers,
    jobs,
    vehicles,
    trackers,
    positions,
    documents,
    photos,
  };
}

/**
 * Deletes every row that belongs to the workspace, and then the sign-in
 * accounts that nothing else uses. Jobs go first, because a job keeps its
 * customer, vehicle and route from being deleted on their own.
 */
export async function deleteWorkspaceRows(
  tx: Prisma.TransactionClient,
  organisationId: string,
  now: Date,
) {
  const members = await tx.organisationMembership.findMany({
    where: { organisationId },
    select: { userId: true },
  });
  await tx.importJob.deleteMany({ where: { organisationId } });
  await tx.organisation.delete({ where: { id: organisationId } });
  for (const userId of new Set(members.map((member) => member.userId))) {
    await eraseAccountIfOnlyOurs(tx, organisationId, userId, now);
  }
}

type Deletion = {
  slug: string;
  operatorEmail: string;
  confirm: boolean;
};

export type WorkspaceDeletionDeps = {
  /** Written before the deletion is kept, so a restore can repeat it. */
  journal: (entry: WorkspaceDeletionEntry) => Promise<void>;
  /** Deletes the workspace's folder of files. */
  removeFiles: (organisationId: string) => Promise<void>;
};

/**
 * Deletes a workspace whose notice period has passed. Without `confirm` it only
 * says what would go. The operator's log keeps a record with ids only.
 */
export async function deleteClosedWorkspace(
  prisma: PrismaClient,
  deps: WorkspaceDeletionDeps,
  change: Deletion,
  now = new Date(),
) {
  const plan = await prisma.$transaction(async (tx) => {
    const operator = await requireOperator(tx, change.operatorEmail);
    const organisation = await requireWorkspace(tx, change.slug);
    const closure = await tx.workspaceClosure.findUnique({
      where: { organisationId: organisation.id },
    });
    if (!closure) {
      throw new OperatorError(
        `${change.slug} is not due for deletion. Schedule it with close first.`,
      );
    }
    if (closure.deleteAfter > now) {
      throw new OperatorError(
        `${change.slug} cannot be deleted before ${closure.deleteAfter.toISOString()}.`,
      );
    }
    return {
      operator,
      organisation,
      summary: await deletionSummary(tx, organisation.id),
    };
  });
  if (!change.confirm) return { ...plan, deleted: false };

  await prisma.$transaction(async (tx) => {
    // Checked again inside the deletion, in case it was cancelled meanwhile.
    const closure = await tx.workspaceClosure.findUnique({
      where: { organisationId: plan.organisation.id },
    });
    if (!closure || closure.deleteAfter > now) {
      throw new OperatorError(`${change.slug} is no longer due for deletion.`);
    }
    await deleteWorkspaceRows(tx, plan.organisation.id, now);
    await tx.platformAuditLog.create({
      data: {
        action: 'WORKSPACE_DELETED',
        operatorId: plan.operator.id,
        targetType: 'Organisation',
        targetId: plan.organisation.id,
        reason: closure.reason,
        createdAt: now,
      },
    });
    // Last: a deletion that cannot be journalled does not happen.
    await deps.journal({
      type: 'workspace-deletion',
      organisationId: plan.organisation.id,
      performedById: plan.operator.id,
      at: now.toISOString(),
      files: [],
    });
  }, DELETION_TRANSACTION);
  await deps.removeFiles(plan.organisation.id);
  return { ...plan, deleted: true };
}

/** In the operator's log, and in the workspace's own without the reason. */
async function record(
  tx: Prisma.TransactionClient,
  action: string,
  operatorId: string,
  organisationId: string,
  reason: string,
  metadata?: Record<string, string>,
) {
  await tx.platformAuditLog.create({
    data: {
      action,
      operatorId,
      targetType: 'Organisation',
      targetId: organisationId,
      reason,
    },
  });
  await tx.auditLog.create({
    data: {
      organisationId,
      actorId: operatorId,
      action,
      entityType: 'Organisation',
      entityId: organisationId,
      metadata,
    },
  });
}

export const DELETION_TRANSACTION_OPTIONS = DELETION_TRANSACTION;
