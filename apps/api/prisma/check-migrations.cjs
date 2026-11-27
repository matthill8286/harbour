// Proves that the migrations, their snapshots and schema.prisma agree.
//
//   node prisma/check-migrations.cjs            fails if they do not
//   node prisma/check-migrations.cjs --write    writes each migration's schema.snapshot
//
// It builds a scratch database on the DATABASE_URL server, applies the migrations
// to it one at a time, and drops it. The user needs CREATEDB.
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { cpSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const {
  fingerprint,
  differences,
  readMigrations,
  connect,
} = require('./migrate.cjs');

const write = process.argv.includes('--write');
const flag = process.argv.indexOf('--prisma-dir');
const prismaDir = flag < 0 ? __dirname : path.resolve(process.argv[flag + 1]);

function prismaCli(args, env) {
  return spawnSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } },
  );
}

async function main() {
  // Prisma reads apps/api/.env itself; loading the client does the same here.
  require('@prisma/client');
  const server = process.env.DATABASE_URL;
  if (!server) throw new Error('DATABASE_URL is not set.');
  const name = `migration_check_${randomUUID().replace(/-/g, '')}`;
  const scratch = new URL(server);
  scratch.pathname = `/${name}`;
  scratch.searchParams.set('schema', 'public');

  const migrations = readMigrations(prismaDir);
  const work = mkdtempSync(path.join(tmpdir(), 'harbour-migrations-'));
  const admin = connect(server);
  let db;
  const problems = [];
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE ${name}`);
    db = connect(scratch.toString());
    cpSync(
      path.join(prismaDir, 'schema.prisma'),
      path.join(work, 'schema.prisma'),
    );
    const from = path.join(prismaDir, 'migrations');
    const to = path.join(work, 'migrations');
    cpSync(
      path.join(from, 'migration_lock.toml'),
      path.join(to, 'migration_lock.toml'),
    );
    for (const migration of migrations) {
      cpSync(path.join(from, migration.name), path.join(to, migration.name), {
        recursive: true,
      });
      const applied = prismaCli(
        ['migrate', 'deploy', '--schema', path.join(work, 'schema.prisma')],
        { DATABASE_URL: scratch.toString() },
      );
      if (applied.status !== 0) {
        throw new Error(
          `${migration.name} does not apply:\n${applied.stdout}${applied.stderr}`,
        );
      }
      const live = await fingerprint(db);
      if (write) {
        writeFileSync(migration.snapshotPath, `${live.join('\n')}\n`);
      } else if (!migration.snapshot) {
        problems.push(`${migration.name} has no schema.snapshot.`);
      } else {
        const found = differences(migration.snapshot, live);
        if (found.length) {
          problems.push(
            `${migration.name}/schema.snapshot is out of date:\n${found.join('\n')}`,
          );
        }
      }
    }
    const diff = prismaCli(
      [
        'migrate',
        'diff',
        '--from-url',
        scratch.toString(),
        '--to-schema-datamodel',
        path.join(prismaDir, 'schema.prisma'),
        '--script',
        '--exit-code',
      ],
      {},
    );
    if (diff.status === 2) {
      problems.push(
        `schema.prisma has changes that no migration makes:\n${diff.stdout}`,
      );
    } else if (diff.status !== 0) {
      throw new Error(`prisma migrate diff failed:\n${diff.stderr}`);
    }
  } finally {
    await db?.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.$disconnect();
    rmSync(work, { recursive: true, force: true });
  }
  if (problems.length) {
    console.error(problems.join('\n\n'));
    console.error('\nSee "Changing the schema" in apps/api/prisma/README.md.');
    process.exitCode = 1;
  } else {
    console.log(
      write
        ? 'Snapshots written. schema.prisma and the migrations agree.'
        : 'schema.prisma, the migrations and their snapshots agree.',
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
