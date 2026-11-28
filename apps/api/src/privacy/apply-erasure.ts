/** The database part of an erasure. Run it inside one transaction. */
import { Prisma } from '@prisma/client';
import type { ErasurePlan, PlannedFile } from './erasure-plan';
import { ERASED_NAME, REMOVED_TEXT, scrubbedMetadata } from './erasure-rules';

export async function applyErasure(
  tx: Prisma.TransactionClient,
  plan: ErasurePlan,
  now: Date,
) {
  const { customer } = plan;
  const organisationId = customer.organisationId;
  const jobIds = plan.jobs.map((job) => job.id);
  const onJobs = { organisationId, importJobId: { in: jobIds } };

  // The audit entries are found through ids that are about to be deleted.
  await scrubAuditEntries(tx, plan);

  await tx.note.deleteMany({ where: plan.noteFilter });
  await tx.locationEvent.deleteMany({ where: plan.gpsFilter });
  await tx.task.updateMany({
    where: onJobs,
    data: { title: REMOVED_TEXT, description: null },
  });
  await tx.journey.updateMany({
    where: onJobs,
    data: { origin: REMOVED_TEXT, destination: REMOVED_TEXT },
  });
  await tx.jobStatusHistory.updateMany({
    where: onJobs,
    data: { note: null },
  });

  for (const file of plan.files) await applyToFile(tx, file);

  await tx.portalInvite.deleteMany({
    where: { organisationId, customerId: customer.id },
  });
  await tx.organisationMembership.deleteMany({
    where: { organisationId, customerId: customer.id, role: 'CUSTOMER' },
  });
  for (const userId of plan.userIds) {
    await eraseAccountIfOnlyOurs(tx, organisationId, userId, now);
  }

  await tx.customer.update({
    where: { id: customer.id },
    data: {
      ...ERASED_NAME,
      email: null,
      phone: null,
      address: null,
      notes: null,
      erasedAt: now,
    },
  });
}

async function applyToFile(tx: Prisma.TransactionClient, file: PlannedFile) {
  const where = { id: file.id };
  const extension = /\.[a-z0-9]{1,10}$/i.exec(file.storageKey)?.[0] ?? '';
  if (file.disposition === 'REMOVE') {
    if (file.kind === 'DOCUMENT') await tx.document.deleteMany({ where });
    else await tx.photo.deleteMany({ where });
    return;
  }
  // A kept file loses its name, which often holds a person's.
  const name = `${file.category.toLowerCase()}${extension}`;
  if (file.kind === 'DOCUMENT') {
    await tx.document.updateMany({
      where,
      data: { name, customerVisible: false },
    });
  } else {
    await tx.photo.updateMany({
      where,
      data: { filename: name, customerVisible: false },
    });
  }
}

async function scrubAuditEntries(
  tx: Prisma.TransactionClient,
  plan: ErasurePlan,
) {
  const entries = await tx.auditLog.findMany({
    where: plan.auditFilter,
    select: { id: true, actorId: true, metadata: true },
  });
  for (const entry of entries) {
    const byThem = entry.actorId && plan.userIds.includes(entry.actorId);
    await tx.auditLog.update({
      where: { id: entry.id },
      data: {
        metadata: entry.metadata
          ? scrubbedMetadata(entry.metadata)
          : Prisma.DbNull,
        // Otherwise the entry would still show the person's name.
        ...(byThem ? { actorId: null } : {}),
      },
    });
  }
}

/**
 * A sign-in account is the person's own. It goes only when nothing outside what
 * is being erased uses it. An account another workspace has anything to do with
 * is not changed in any way.
 */
export async function eraseAccountIfOnlyOurs(
  tx: Prisma.TransactionClient,
  organisationId: string,
  userId: string,
  now: Date,
) {
  // Another workspace inviting this person at the same moment waits for this.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const elsewhere = { organisationId: { not: organisationId } };
  const uses = await tx.user.findUnique({
    where: { id: userId },
    select: {
      platformAdmin: { select: { id: true } },
      _count: {
        select: {
          // Any membership at all, here too, means the account is still in use.
          memberships: true,
          supportAccessGrants: true,
          staffInvites: true,
          createdStaffInvites: true,
          createdPortalInvites: true,
          portalInvites: true,
          auditLogs: { where: elsewhere },
          notes: { where: elsewhere },
          documents: { where: elsewhere },
          photos: { where: elsewhere },
          statusChanges: { where: elsewhere },
          assignedTasks: { where: elsewhere },
        },
      },
    },
  });
  if (!uses || uses.platformAdmin) return;
  if (Object.values(uses._count).some((count) => count > 0)) return;

  // A note must keep an author, so an account that wrote one stays as a shell.
  if (await tx.note.count({ where: { authorId: userId } })) {
    await tx.twoFactor.deleteMany({ where: { userId } });
    await tx.passwordReset.deleteMany({ where: { userId } });
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `erased-${userId}@erased.invalid`,
        name: 'Erased user',
        passwordHash: null,
        twoFactorEnabled: false,
        sessionsRevokedAt: now,
      },
    });
    return;
  }
  await tx.user.delete({ where: { id: userId } });
}
