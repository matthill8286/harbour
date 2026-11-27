import type { Prisma } from '@prisma/client';
import type { PrismaService } from './prisma.service';

/**
 * Runs `work` in one transaction while holding a named lock. A second call with
 * the same name waits, then sees what the first one saved. Use it where a check
 * and the writes that rely on it must not run twice at once.
 */
export function lockedTransaction<T>(
  prisma: PrismaService,
  name: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${name}))`;
      return work(tx);
    },
    // Longer than Prisma's defaults, to leave time to wait for the lock.
    { maxWait: 10_000, timeout: 15_000 },
  );
}

/** A workspace's team, portal access and invites. */
export const accessLock = (organisationId: string) =>
  `access:${organisationId}`;

/** A workspace's tracker assignments. */
export const trackerLock = (organisationId: string) =>
  `tracker-assignment:${organisationId}`;
