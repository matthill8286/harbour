/**
 * What the platform operator can do: hold the role, suspend a workspace and
 * restore it. No HTTP route calls any of this. It runs only from the command in
 * operator.ts, by someone who can already run commands on the server.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

/** Long enough to say why, so a record is never just "x". */
export const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

export class OperatorError extends Error {}

const normalise = (email: string) => email.trim().toLowerCase();

/**
 * The role goes only to an account that exists, has its own password and has
 * two-factor sign-in on. This never creates or changes an account.
 */
export async function grantOperator(prisma: PrismaClient, email: string) {
  return prisma.$transaction(async (tx) => {
    const account = await requireStrongAccount(tx, email);
    const existing = await tx.platformAdmin.findUnique({
      where: { userId: account.id },
    });
    if (existing) return { userId: account.id, added: false };
    await tx.platformAdmin.create({ data: { userId: account.id } });
    await tx.platformAuditLog.create({
      data: {
        action: 'OPERATOR_GRANTED',
        targetType: 'User',
        targetId: account.id,
      },
    });
    return { userId: account.id, added: true };
  });
}

export async function revokeOperator(prisma: PrismaClient, email: string) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({
      where: { email: normalise(email) },
      select: { id: true },
    });
    const { count } = account
      ? await tx.platformAdmin.deleteMany({ where: { userId: account.id } })
      : { count: 0 };
    if (!account || count === 0) {
      throw new OperatorError('That account is not a platform operator.');
    }
    await tx.platformAuditLog.create({
      data: {
        action: 'OPERATOR_REVOKED',
        targetType: 'User',
        targetId: account.id,
      },
    });
    return { userId: account.id };
  });
}

export async function listOperators(prisma: PrismaClient) {
  const rows = await prisma.platformAdmin.findMany({
    include: { user: { select: { email: true, twoFactorEnabled: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    email: row.user.email,
    twoFactorEnabled: row.user.twoFactorEnabled,
    since: row.createdAt,
  }));
}

type Change = { slug: string; operatorEmail: string; reason: string };

/**
 * Stops sign-in, API access, outgoing mail and GPS intake for one workspace.
 * It changes the workspace's status and records why. It deletes nothing.
 */
export function suspendWorkspace(
  prisma: PrismaClient,
  change: Change,
  now = new Date(),
) {
  const reason = requireReason(change.reason);
  return prisma.$transaction(async (tx) => {
    const operator = await requireOperator(tx, change.operatorEmail);
    const organisation = await requireWorkspace(tx, change.slug);
    // Only an active workspace, so two commands at once cannot both record one.
    const { count } = await tx.organisation.updateMany({
      where: { id: organisation.id, status: 'ACTIVE' },
      data: { status: 'SUSPENDED' },
    });
    if (count !== 1) {
      throw new OperatorError(
        `${change.slug} is not active, so it cannot be suspended.`,
      );
    }
    await tx.workspaceSuspension.create({
      data: {
        organisationId: organisation.id,
        reason,
        suspendedById: operator.id,
        suspendedAt: now,
      },
    });
    await record(
      tx,
      'WORKSPACE_SUSPENDED',
      operator.id,
      organisation.id,
      reason,
    );
    return organisation;
  });
}

export function restoreWorkspace(
  prisma: PrismaClient,
  change: Change,
  now = new Date(),
) {
  const reason = requireReason(change.reason);
  return prisma.$transaction(async (tx) => {
    const operator = await requireOperator(tx, change.operatorEmail);
    const organisation = await requireWorkspace(tx, change.slug);
    const { count } = await tx.organisation.updateMany({
      where: { id: organisation.id, status: 'SUSPENDED' },
      data: { status: 'ACTIVE' },
    });
    if (count !== 1) {
      throw new OperatorError(
        `${change.slug} is not suspended, so there is nothing to restore.`,
      );
    }
    await tx.workspaceSuspension.updateMany({
      where: { organisationId: organisation.id, restoredAt: null },
      data: {
        restoredAt: now,
        restoredById: operator.id,
        restoreReason: reason,
      },
    });
    await record(
      tx,
      'WORKSPACE_RESTORED',
      operator.id,
      organisation.id,
      reason,
    );
    return organisation;
  });
}

/** In the operator's log, and in the workspace's own without the reason. */
async function record(
  tx: Prisma.TransactionClient,
  action: string,
  operatorId: string,
  organisationId: string,
  reason: string,
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
    },
  });
}

function requireReason(reason: string) {
  const trimmed = reason.trim();
  if (
    trimmed.length < MIN_REASON_LENGTH ||
    trimmed.length > MAX_REASON_LENGTH
  ) {
    throw new OperatorError(
      `Give a reason of ${MIN_REASON_LENGTH} to ${MAX_REASON_LENGTH} characters.`,
    );
  }
  return trimmed;
}

async function requireStrongAccount(
  tx: Prisma.TransactionClient,
  email: string,
) {
  const account = await tx.user.findUnique({
    where: { email: normalise(email) },
    select: { id: true, passwordHash: true, twoFactorEnabled: true },
  });
  if (!account?.passwordHash) {
    throw new OperatorError(
      'There is no account with a password for that email.',
    );
  }
  if (!account.twoFactorEnabled) {
    throw new OperatorError(
      'That account must turn on two-factor sign-in first.',
    );
  }
  return account;
}

/** Checked again on every use, so a revoked or weakened account can do nothing. */
async function requireOperator(tx: Prisma.TransactionClient, email: string) {
  const account = await requireStrongAccount(tx, email);
  const role = await tx.platformAdmin.findUnique({
    where: { userId: account.id },
  });
  if (!role) {
    throw new OperatorError('That account is not a platform operator.');
  }
  return account;
}

async function requireWorkspace(tx: Prisma.TransactionClient, slug: string) {
  const organisation = await tx.organisation.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true },
  });
  if (!organisation) {
    throw new OperatorError(`There is no workspace called ${slug}.`);
  }
  return organisation;
}
