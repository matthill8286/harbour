/**
 * The platform operator's commands, run on the server. In the api container:
 *
 *   node dist/src/platform/operator.js grant <email>
 *   node dist/src/platform/operator.js revoke <email>
 *   node dist/src/platform/operator.js list
 *   node dist/src/platform/operator.js suspend <workspace-slug> --by <operator email> --reason "<why>"
 *   node dist/src/platform/operator.js restore <workspace-slug> --by <operator email> --reason "<why>"
 *
 * `--by` records who did it. It is not a sign-in: only someone who can already
 * run commands on the server, and so reach the database, can run this at all.
 */
import { PrismaClient } from '@prisma/client';
import { runOperatorCommand } from './operator-command';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(await runOperatorCommand(prisma, process.argv.slice(2)));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
