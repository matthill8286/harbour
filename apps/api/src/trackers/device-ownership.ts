import type { PrismaClient } from '@prisma/client';
import {
  imeiKey,
  imeiKeySql,
  imeiLock,
  realProviderSql,
} from '../integrations/gps-device';
import { DEFAULT_GPS_PROVIDER } from '../integrations/gps-providers';

/**
 * The kind of proof the operator saw. Only the kind is recorded, never the
 * document itself, so the audit log holds no personal data from it.
 */
export const OWNERSHIP_PROOFS = [
  'invoice',
  'delivery-note',
  'label-photo',
  'other',
] as const;
export type OwnershipProof = (typeof OWNERSHIP_PROOFS)[number];

export function isOwnershipProof(value: string): value is OwnershipProof {
  return (OWNERSHIP_PROOFS as readonly string[]).includes(value);
}

/**
 * Records the platform operator's decision that a workspace owns a real unit.
 * Run it only after seeing proof: the software cannot check that. Every other
 * claim on the IMEI is disputed from now on and receives nothing. Positions
 * already stored stay with the workspace that received them.
 */
export function confirmDeviceOwner(
  prisma: PrismaClient,
  imei: string,
  workspaceSlug: string,
  proof: OwnershipProof,
) {
  const key = imeiKey(imei);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${imeiLock(key)}))`;
    const workspace = await tx.organisation.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true },
    });
    if (!workspace) throw new Error(`No workspace has slug ${workspaceSlug}`);
    if (!key) throw new Error('Give the IMEI of the unit');
    const claims = await tx.$queryRaw<
      Array<{ id: string; organisationId: string; live: boolean }>
    >`
      SELECT "id", "organisationId", EXISTS (
        SELECT 1 FROM "TrackerAssignment" a
        WHERE a."trackerId" = "Tracker"."id" AND a."removedAt" IS NULL
      ) AS "live"
      FROM "Tracker"
      WHERE ${realProviderSql} AND ${imeiKeySql} = ${key}
      ORDER BY "live" DESC, "createdAt", "id"`;
    const owned = claims.find((c) => c.organisationId === workspace.id);
    const others = claims.filter((c) => c.id !== owned?.id).map((c) => c.id);
    // Others first, so the unique index never sees two undisputed claims.
    await tx.tracker.updateMany({
      where: { id: { in: others } },
      data: { imeiConflictAt: new Date(), ownershipConfirmedAt: null },
    });
    const current = owned
      ? await tx.tracker.findUniqueOrThrow({ where: { id: owned.id } })
      : null;
    // Running it again keeps the first confirmation time.
    const ownershipConfirmedAt = current?.ownershipConfirmedAt ?? new Date();
    const tracker = current
      ? await tx.tracker.update({
          where: { id: current.id },
          data: { imeiConflictAt: null, ownershipConfirmedAt },
        })
      : await tx.tracker.create({
          data: {
            organisationId: workspace.id,
            serialNumber: key,
            provider: DEFAULT_GPS_PROVIDER,
            ownershipConfirmedAt,
          },
        });
    // The operator has no account in the workspace, so the entry has no actor.
    await tx.auditLog.create({
      data: {
        organisationId: workspace.id,
        action: 'TRACKER_OWNERSHIP_CONFIRMED',
        entityType: 'Tracker',
        entityId: tracker.id,
        metadata: {
          serialNumber: tracker.serialNumber,
          proof,
          disputedClaims: others.length,
        },
      },
    });
    return { tracker, disputed: others.length };
  });
}
