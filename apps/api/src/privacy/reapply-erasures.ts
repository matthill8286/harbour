/**
 * Repeats, after a database restore, the erasures made since the dump was taken.
 * It deletes only the files the journal names and those the rules remove: a
 * restored database that is older than the uploads must not make newer files
 * look unwanted.
 */
import type { PrismaService } from '../prisma/prisma.service';
import { applyErasure } from './apply-erasure';
import { buildErasurePlan } from './erasure-plan';
import type {
  ErasureEntry,
  JournalEntry,
  ReviewRemovalEntry,
} from './erasure-journal';
import {
  ERASURE_TRANSACTION,
  removeRecord,
  type CustomerErasureService,
} from './customer-erasure.service';

export type ReapplyResult = {
  entry: JournalEntry;
  /** `already` means the database has it. Its files are still deleted. */
  outcome: 'applied' | 'would-apply' | 'already' | 'not-in-database';
  filesNotRemoved: number;
};

export async function reapplyErasures(
  prisma: PrismaService,
  erasures: CustomerErasureService,
  entries: JournalEntry[],
  { confirm }: { confirm: boolean },
): Promise<ReapplyResult[]> {
  const results: ReapplyResult[] = [];
  for (const entry of entries) {
    const outcome =
      entry.type === 'erasure'
        ? await repeatErasure(prisma, erasures, entry, confirm)
        : await repeatRemoval(prisma, erasures, entry, confirm);
    // Restored uploads may have brought the files back, even with the rows gone.
    const filesNotRemoved = confirm
      ? await erasures.removeFiles(entry.organisationId, entry.files)
      : 0;
    results.push({ entry, outcome, filesNotRemoved });
  }
  return results;
}

async function repeatErasure(
  prisma: PrismaService,
  erasures: CustomerErasureService,
  entry: ErasureEntry,
  confirm: boolean,
): Promise<ReapplyResult['outcome']> {
  const outcome = await prisma.$transaction(async (tx) => {
    await erasures.hold(tx, entry.organisationId, entry.customerId);
    if (
      await tx.customerErasure.findUnique({ where: { id: entry.erasureId } })
    ) {
      return { result: 'already' as const, files: [] };
    }
    // An open job does not stop it: it was closed when the erasure was made.
    const plan = await buildErasurePlan(
      tx,
      entry.organisationId,
      entry.customerId,
    );
    if (!plan) return { result: 'not-in-database' as const, files: [] };
    if (!confirm) return { result: 'would-apply' as const, files: [] };
    const files = plan.files
      .filter((file) => file.disposition === 'REMOVE')
      .map((file) => ({ key: file.storageKey, mimeType: file.mimeType }));
    const performedAt = new Date(entry.at);
    await applyErasure(tx, plan, performedAt);
    await tx.customerErasure.create({
      data: {
        id: entry.erasureId,
        organisationId: entry.organisationId,
        customerId: entry.customerId,
        performedById: entry.performedById,
        performedAt,
        reappliedAt: new Date(),
        summary: { reapplied: true },
        reviewItems: {
          create: [
            ...plan.files.filter((file) => file.disposition === 'REVIEW'),
            ...plan.flaggedMoney,
          ].map((item) => ({
            kind: item.kind,
            recordId: item.id,
            importJobId: item.importJobId,
            reason: 'Flagged again after a restore.',
          })),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        organisationId: entry.organisationId,
        action: 'CUSTOMER_ERASURE_REAPPLIED',
        entityType: 'Customer',
        entityId: entry.customerId,
        metadata: { customerId: entry.customerId },
      },
    });
    return { result: 'applied' as const, files };
  }, ERASURE_TRANSACTION);
  await erasures.removeFiles(entry.organisationId, outcome.files);
  return outcome.result;
}

async function repeatRemoval(
  prisma: PrismaService,
  erasures: CustomerErasureService,
  entry: ReviewRemovalEntry,
  confirm: boolean,
): Promise<ReapplyResult['outcome']> {
  const item = await prisma.erasureReviewItem.findUnique({
    where: {
      erasureId_kind_recordId: {
        erasureId: entry.erasureId,
        kind: entry.kind,
        recordId: entry.recordId,
      },
    },
  });
  if (item?.decision === 'REMOVED') return 'already';
  if (!confirm) return 'would-apply';
  const files = await prisma.$transaction(async (tx) => {
    await erasures.hold(tx, entry.organisationId, entry.customerId);
    if (item) {
      await tx.erasureReviewItem.update({
        where: { id: item.id },
        data: {
          decision: 'REMOVED',
          decidedById: entry.performedById,
          decidedAt: new Date(entry.at),
        },
      });
    }
    return removeRecord(tx, entry.organisationId, entry.kind, entry.recordId);
  }, ERASURE_TRANSACTION);
  await erasures.removeFiles(entry.organisationId, files);
  return 'applied';
}
