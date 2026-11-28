/**
 * For the platform operator, after checking that the workspace holds the unit:
 *
 *   node dist/src/trackers/confirm-device-owner.js <imei> <workspace-slug> <proof>
 *
 * <proof> is the kind of proof seen: invoice, delivery-note, label-photo or
 * other. It is written to the workspace's audit log.
 */
import { PrismaClient } from '@prisma/client';
import {
  confirmDeviceOwner,
  isOwnershipProof,
  OWNERSHIP_PROOFS,
} from './device-ownership';

async function main() {
  const [imei, slug, proof = ''] = process.argv.slice(2);
  if (!imei || !slug || !isOwnershipProof(proof)) {
    throw new Error(
      `Usage: confirm-device-owner <imei> <workspace-slug> <${OWNERSHIP_PROOFS.join('|')}>`,
    );
  }
  const prisma = new PrismaClient();
  try {
    const { tracker, disputed } = await confirmDeviceOwner(
      prisma,
      imei,
      slug,
      proof,
    );
    console.log(
      `Tracker ${tracker.id} in ${slug} now owns this unit. ${disputed} other claims are disputed.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
