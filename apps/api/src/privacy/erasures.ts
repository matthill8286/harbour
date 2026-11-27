/**
 * Run in the api container after a database restore, before the api is started:
 *
 *   node dist/src/privacy/erasures.js list  [--journal <file>]
 *   node dist/src/privacy/erasures.js apply [--journal <file>] [--confirm]
 *
 * Without --confirm, `apply` only says what it would do.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { FileDeliveryService } from '../integrations/file-delivery.service';
import { StorageService } from '../integrations/storage.service';
import { CustomerErasureService } from './customer-erasure.service';
import { ErasureJournal } from './erasure-journal';
import { reapplyErasures } from './reapply-erasures';

const USAGE = 'Usage: erasures list|apply [--journal <file>] [--confirm]';

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const confirm = rest.includes('--confirm');
  const at = rest.indexOf('--journal');
  const path = at === -1 ? undefined : rest[at + 1];
  const known = rest.length === (confirm ? 1 : 0) + (at === -1 ? 0 : 2);
  if (!['list', 'apply'].includes(command) || !known) throw new Error(USAGE);

  const config = new ConfigService();
  const journal = new ErasureJournal(config);
  const entries = await journal.read(path);
  console.log(`${entries.length} entries in ${path ?? journal.path}`);
  if (command === 'list') {
    for (const entry of entries) {
      console.log(
        `${entry.at} ${entry.type} workspace=${entry.organisationId} customer=${entry.customerId}`,
      );
    }
    return;
  }
  const prisma = new PrismaClient() as PrismaService;
  try {
    const storage = new StorageService(config);
    const erasures = new CustomerErasureService(
      prisma,
      storage,
      new FileDeliveryService(storage),
      journal,
    );
    const results = await reapplyErasures(prisma, erasures, entries, {
      confirm,
    });
    for (const { entry, outcome, filesNotRemoved } of results) {
      console.log(
        `${outcome} ${entry.type} customer=${entry.customerId}${
          filesNotRemoved
            ? ` (${filesNotRemoved} files could not be deleted)`
            : ''
        }`,
      );
    }
    if (!confirm)
      console.log('Nothing was changed. Add --confirm to apply them.');
    if (results.some((result) => result.filesNotRemoved)) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
