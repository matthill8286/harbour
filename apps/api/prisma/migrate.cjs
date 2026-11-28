// The only way a release changes the database. See README.md in this folder.
//
//   node prisma/migrate.cjs deploy             verify, apply pending migrations, verify again
//   node prisma/migrate.cjs check              report what deploy would do; changes nothing
//   node prisma/migrate.cjs recover <name>     clear a failed migration that left nothing behind
//
// It is plain JavaScript so that the migrate image can run it without a TypeScript runner.
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const SNAPSHOT = 'schema.snapshot';
const FINGERPRINT = path.join(__dirname, 'schema-fingerprint.sql');

class Refusal extends Error {}

/** The migrations in this folder, in the order Prisma applies them. */
function readMigrations(prismaDir) {
  const folder = path.join(prismaDir, 'migrations');
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(folder, name, 'migration.sql'));
      const snapshot = path.join(folder, name, SNAPSHOT);
      return {
        name,
        checksum: createHash('sha256').update(sql).digest('hex'),
        snapshotPath: snapshot,
        snapshot: existsSync(snapshot)
          ? readFileSync(snapshot, 'utf8').split('\n').filter(Boolean)
          : null,
      };
    });
}

async function fingerprint(db) {
  const rows = await db.$queryRawUnsafe(readFileSync(FINGERPRINT, 'utf8'));
  return rows.map((row) => row.line);
}

/** Prisma's record of what it has applied, or nothing if it has never run here. */
async function readHistory(db) {
  const [{ found }] = await db.$queryRawUnsafe(
    `SELECT to_regclass(quote_ident(current_schema()) || '._prisma_migrations') IS NOT NULL AS found`,
  );
  if (!found) return [];
  return db.$queryRawUnsafe(
    `SELECT migration_name AS name, checksum, finished_at AS "finishedAt",
            rolled_back_at AS "rolledBackAt"
     FROM _prisma_migrations ORDER BY started_at`,
  );
}

function differences(expected, actual) {
  const missing = expected.filter((line) => !actual.includes(line));
  const extra = actual.filter((line) => !expected.includes(line));
  return [
    ...missing.map((line) => `  missing:    ${line}`),
    ...extra.map((line) => `  unexpected: ${line}`),
  ];
}

function requireSchema(migration, live, explanation) {
  if (!migration.snapshot) {
    throw new Refusal(`${migration.name} has no ${SNAPSHOT}.`);
  }
  const found = differences(migration.snapshot, live);
  if (found.length) {
    throw new Refusal(
      `${explanation}\nCompared with the schema after ${migration.name}:\n${found.join('\n')}`,
    );
  }
}

const unfinished = (history) =>
  history.filter((row) => !row.finishedAt && !row.rolledBackAt);

/**
 * Decides what a deploy has to do, and refuses unless the database is exactly
 * what its history says it should be. It only reads.
 */
async function plan(db, migrations) {
  if (!migrations.length) throw new Refusal('There are no migrations.');
  for (const migration of migrations) {
    if (!migration.snapshot) {
      throw new Refusal(`${migration.name} has no ${SNAPSHOT}.`);
    }
  }
  const history = await readHistory(db);
  const [failed] = unfinished(history);
  if (failed) {
    throw new Refusal(
      `The migration ${failed.name} started and did not finish. Nothing more is applied until ` +
        `this is resolved. See "A failed migration" in apps/api/prisma/README.md.`,
    );
  }
  const applied = history.filter((row) => row.finishedAt && !row.rolledBackAt);
  const live = await fingerprint(db);

  if (!applied.length) {
    if (!live.length) return { baseline: false, pending: migrations };
    // A database that `db push` built. It is accepted only if it is the baseline exactly.
    requireSchema(
      migrations[0],
      live,
      'This database has tables but no migration history, and it does not match the baseline.',
    );
    return { baseline: true, pending: migrations.slice(1) };
  }

  const names = new Set(applied.map((row) => row.name));
  const unknown = [...names].filter(
    (name) => !migrations.some((migration) => migration.name === name),
  );
  if (unknown.length) {
    throw new Refusal(
      `The database has migrations that this build does not: ${unknown.join(', ')}. ` +
        'This build is older than the database.',
    );
  }
  const done = migrations.slice(0, names.size);
  const outOfOrder = done.filter((migration) => !names.has(migration.name));
  if (outOfOrder.length) {
    throw new Refusal(
      `These migrations sort before ones already applied: ${outOfOrder.map((m) => m.name).join(', ')}. ` +
        'Rename them so that they sort last.',
    );
  }
  for (const migration of done) {
    const row = applied.find((r) => r.name === migration.name);
    if (row.checksum !== migration.checksum) {
      throw new Refusal(
        `${migration.name} was edited after it was applied. Restore the file and add a new migration.`,
      );
    }
  }
  requireSchema(
    done.at(-1),
    live,
    'The live schema is not what the migration history says it should be.',
  );
  return { baseline: false, pending: migrations.slice(done.length) };
}

function prismaCli(prismaDir, args) {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      ...args,
      '--schema',
      path.join(prismaDir, 'schema.prisma'),
    ],
    { stdio: 'inherit', env: process.env },
  );
  if (result.status !== 0) {
    throw new Refusal(`prisma ${args.join(' ')} failed.`);
  }
}

/**
 * One connection, so that the lock taken on it covers the whole run and two
 * releases cannot both mark the baseline.
 */
function connect(url) {
  const single = new URL(url);
  single.searchParams.set('connection_limit', '1');
  return new PrismaClient({ datasources: { db: { url: single.toString() } } });
}

async function withDatabase(work) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Refusal('DATABASE_URL is not set.');
  const db = connect(url);
  try {
    return await work(db);
  } finally {
    await db.$disconnect();
  }
}

const lock = (db) =>
  db.$executeRawUnsafe(`SELECT pg_advisory_lock(hashtext('harbour-migrate'))`);

async function check(db, migrations) {
  const { baseline, pending } = await plan(db, migrations);
  if (baseline) {
    console.log(
      `The database matches the baseline and has no history. deploy would mark ${migrations[0].name} as applied.`,
    );
  }
  console.log(
    pending.length
      ? `deploy would apply: ${pending.map((m) => m.name).join(', ')}`
      : 'There are no migrations to apply.',
  );
}

async function deploy(db, migrations, prismaDir) {
  await lock(db);
  const { baseline, pending } = await plan(db, migrations);
  if (baseline) {
    console.log(
      `The database matches the baseline. Marking ${migrations[0].name} as applied.`,
    );
    prismaCli(prismaDir, [
      'migrate',
      'resolve',
      '--applied',
      migrations[0].name,
    ]);
  }
  if (pending.length) prismaCli(prismaDir, ['migrate', 'deploy']);
  requireSchema(
    migrations.at(-1),
    await fingerprint(db),
    'The migrations ran, but the schema is not the expected one. Do not start the new api.',
  );
  console.log('The database schema is as expected.');
}

/**
 * PostgreSQL undoes a failed migration's statements together, unless the file
 * commits part way. This clears Prisma's failure record only when the schema
 * shows that nothing was left behind.
 */
async function recover(db, migrations, prismaDir, name) {
  await lock(db);
  const history = await readHistory(db);
  if (!unfinished(history).some((row) => row.name === name)) {
    throw new Refusal(`${name ?? '(no name)'} is not a failed migration.`);
  }
  const index = migrations.findIndex((migration) => migration.name === name);
  // The build that has the fix may have renamed or removed the failed folder.
  const done = new Set(
    history
      .filter((row) => row.finishedAt && !row.rolledBackAt)
      .map((row) => row.name),
  );
  const previous = migrations
    .filter((m, i) => (index < 0 || i < index) && done.has(m.name))
    .at(-1);
  const live = await fingerprint(db);
  if (previous) {
    requireSchema(
      previous,
      live,
      `${name} left changes behind. Restore the dump taken before the release, or repair the schema by hand.`,
    );
  } else if (live.length) {
    throw new Refusal(`${name} left objects behind in an empty database.`);
  }
  if (index < 0) {
    throw new Refusal(
      `This build has no folder named ${name}. Run recover with the build that failed.`,
    );
  }
  prismaCli(prismaDir, ['migrate', 'resolve', '--rolled-back', name]);
  console.log(`${name} is marked as rolled back. Fix the cause, then deploy.`);
}

async function main(argv) {
  const args = [...argv];
  // For the tests, which run against copies of this folder with extra migrations.
  const flag = args.indexOf('--prisma-dir');
  const prismaDir =
    flag < 0 ? __dirname : path.resolve(args.splice(flag, 2)[1]);
  const [command = 'deploy', name] = args;
  const migrations = readMigrations(prismaDir);
  if (command === 'deploy') {
    return withDatabase((db) => deploy(db, migrations, prismaDir));
  }
  if (command === 'check') {
    return withDatabase((db) => check(db, migrations));
  }
  if (command === 'recover') {
    return withDatabase((db) => recover(db, migrations, prismaDir, name));
  }
  throw new Refusal(`Unknown command: ${command}`);
}

module.exports = { fingerprint, differences, readMigrations, connect };

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof Refusal ? `REFUSED: ${error.message}` : error,
    );
    process.exitCode = 1;
  });
}
