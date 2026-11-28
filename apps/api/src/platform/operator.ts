/**
 * The platform operator's commands, run on the server. In the api container:
 *
 *   node dist/src/platform/operator.js grant <email>
 *   node dist/src/platform/operator.js revoke <email>
 *   node dist/src/platform/operator.js list
 *   node dist/src/platform/operator.js suspend <workspace-slug> --by <operator email> --reason "<why>"
 *   node dist/src/platform/operator.js restore <workspace-slug> --by <operator email> --reason "<why>"
 *   node dist/src/platform/operator.js close <workspace-slug> --by <operator email> --contract-end <YYYY-MM-DD> --reason "<why>"
 *   node dist/src/platform/operator.js cancel-close <workspace-slug> --by <operator email> --reason "<why>"
 *   node dist/src/platform/operator.js delete-closed <workspace-slug> --by <operator email> [--confirm]
 *
 * `close` records the end of a workspace's contract. The workspace keeps working
 * through the notice period (WORKSPACE_DELETION_NOTICE_DAYS, 30 by default), so
 * its Admins can export everything. `delete-closed` then deletes its data and
 * files. Without --confirm it only says what would go.
 *
 * `--by` records who did it. It is not a sign-in: only someone who can already
 * run commands on the server, and so reach the database, can run this at all.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { StorageService } from '../integrations/storage.service';
import { ErasureJournal } from '../privacy/erasure-journal';
import { runOperatorCommand } from './operator-command';

async function main() {
  const prisma = new PrismaClient();
  try {
    const config = new ConfigService();
    const journal = new ErasureJournal(config);
    const storage = new StorageService(config);
    console.log(
      await runOperatorCommand(prisma, process.argv.slice(2), {
        journal: (entry) => journal.append(entry),
        removeFiles: (organisationId) =>
          storage.removeWorkspace(organisationId),
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
