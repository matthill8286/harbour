/**
 * For the platform operator, after checking that the workspace holds the unit:
 *
 *   node dist/src/trackers/confirm-device-owner.js <imei> <workspace-slug>
 */
import { PrismaClient } from '@prisma/client';
import { confirmDeviceOwner } from './device-ownership';

async function main() {
  const [imei, slug] = process.argv.slice(2);
  if (!imei || !slug) {
    throw new Error('Usage: confirm-device-owner <imei> <workspace-slug>');
  }
  const prisma = new PrismaClient();
  try {
    const { tracker, disputed } = await confirmDeviceOwner(prisma, imei, slug);
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
