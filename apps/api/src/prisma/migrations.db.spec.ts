/**
 * prisma/migrate.cjs, which releases run, and prisma/check-migrations.cjs, which
 * CI runs. Skipped unless TEST_DATABASE_URL is set. Each test makes and drops
 * its own databases, so that user needs CREATEDB.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;

const apiRoot = join(__dirname, '../..');
const prismaRoot = join(apiRoot, 'prisma');
const BASELINE = '20261127000000_baseline';
/** Sorts after every real migration. */
const EXTRA = '99990101000000_extra';

type Result = { code: number; output: string };

describeWithDatabase('migrating a database', () => {
  jest.setTimeout(180_000);

  const folders: string[] = [];
  const databases: string[] = [];
  const clients: PrismaClient[] = [];
  let admin: PrismaClient;

  beforeAll(() => {
    admin = new PrismaClient({ datasources: { db: { url: url! } } });
  });

  afterAll(async () => {
    for (const client of clients) await client.$disconnect();
    for (const name of databases) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`,
      );
    }
    await admin?.$disconnect();
    for (const folder of folders) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  function run(args: string[], databaseUrl: string) {
    return new Promise<Result>((resolve) => {
      execFile(
        process.execPath,
        args,
        {
          cwd: apiRoot,
          env: { ...process.env, DATABASE_URL: databaseUrl },
        },
        (error, stdout, stderr) =>
          resolve({
            code: error ? Number(error.code ?? 1) : 0,
            output: stdout + stderr,
          }),
      );
    });
  }

  async function database() {
    const name = `migrate_${randomUUID().replace(/-/g, '')}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE ${name}`);
    databases.push(name);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    const own = target.toString();
    const db = new PrismaClient({ datasources: { db: { url: own } } });
    clients.push(db);
    const migrate = (...args: string[]) =>
      run([join(prismaRoot, 'migrate.cjs'), ...args], own);
    const sql = (statement: string) => db.$executeRawUnsafe(statement);
    const history = () =>
      db.$queryRawUnsafe<
        Array<{ name: string; applied: boolean; rolledBack: boolean }>
      >(
        `SELECT migration_name AS name, finished_at IS NOT NULL AS applied,
                rolled_back_at IS NOT NULL AS "rolledBack"
         FROM _prisma_migrations ORDER BY started_at`,
      );
    const tableExists = async (table: string) => {
      const [row] = await db.$queryRawUnsafe<Array<{ found: boolean }>>(
        `SELECT to_regclass('"${table}"') IS NOT NULL AS found`,
      );
      return row.found;
    };
    return { url: own, db, migrate, sql, history, tableExists };
  }

  type Database = Awaited<ReturnType<typeof database>>;

  /**
   * A database as releases before migrations left it: the baseline's structure
   * and no history.
   */
  async function unrecorded(): Promise<Database> {
    const target = await database();
    const folder = build();
    for (const name of migrationNames.filter((n) => n !== BASELINE)) {
      rmSync(join(folder, 'migrations', name), { recursive: true });
    }
    expect((await target.migrate('deploy', '--prisma-dir', folder)).code).toBe(
      0,
    );
    await target.sql('DROP TABLE _prisma_migrations');
    return target;
  }

  /** A copy of the prisma folder, to stand for another build. */
  function build() {
    const folder = mkdtempSync(join(tmpdir(), 'harbour-build-'));
    folders.push(folder);
    for (const item of [
      'schema.prisma',
      'schema-fingerprint.sql',
      'migrations',
    ]) {
      cpSync(join(prismaRoot, item), join(folder, item), { recursive: true });
    }
    return folder;
  }

  /** Adds a migration whose snapshot says it adds nothing. */
  function addMigration(folder: string, sql: string) {
    const migrations = join(folder, 'migrations');
    const last = readdirSync(migrations, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1)!;
    mkdirSync(join(migrations, EXTRA));
    writeFileSync(join(migrations, EXTRA, 'migration.sql'), sql);
    cpSync(
      join(migrations, last, 'schema.snapshot'),
      join(migrations, EXTRA, 'schema.snapshot'),
    );
    return join(migrations, EXTRA);
  }

  const migrationNames = readdirSync(join(prismaRoot, 'migrations'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it('has migrations, snapshots and a schema.prisma that agree', async () => {
    const result = await run([join(prismaRoot, 'check-migrations.cjs')], url!);
    expect(result.output).toContain('agree');
    expect(result.code).toBe(0);
  });

  it('fails the check when schema.prisma changes without a migration', async () => {
    const folder = build();
    appendFileSync(
      join(folder, 'schema.prisma'),
      '\nmodel Forgotten {\n  id String @id\n}\n',
    );
    const result = await run(
      [join(prismaRoot, 'check-migrations.cjs'), '--prisma-dir', folder],
      url!,
    );
    expect(result.code).toBe(1);
    expect(result.output).toContain('changes that no migration makes');
    expect(result.output).toContain('Forgotten');
  });

  it('builds an empty database, and can be run again', async () => {
    const target = await database();
    expect((await target.migrate('deploy')).code).toBe(0);
    const again = await target.migrate('deploy');
    expect(again.code).toBe(0);
    expect(await target.history()).toEqual(
      migrationNames.map((name) => ({
        name,
        applied: true,
        rolledBack: false,
      })),
    );
  });

  it('marks the baseline once on a database without history, keeping its rows', async () => {
    const target = await unrecorded();
    await target.sql(
      `INSERT INTO "Organisation" (id, name, slug, "updatedAt") VALUES ('a', 'a', 'a', now())`,
    );

    const checked = await target.migrate('check');
    expect(checked.output).toContain(`would mark ${BASELINE}`);
    expect(await target.tableExists('_prisma_migrations')).toBe(false);

    // Two releases at once.
    const results = await Promise.all([
      target.migrate('deploy'),
      target.migrate('deploy'),
    ]);
    expect(results.map((r) => r.code)).toEqual([0, 0]);
    expect((await target.migrate('deploy')).code).toBe(0);

    const history = await target.history();
    expect(history.filter((row) => row.name === BASELINE)).toHaveLength(1);
    expect(history.every((row) => row.applied)).toBe(true);
    await expect(target.db.organisation.count()).resolves.toBe(1);
  });

  it.each([
    [
      'a missing GPS index',
      'DROP INDEX "Tracker_realImei_key"',
      'Tracker_realImei_key',
    ],
    [
      'an extra column',
      'ALTER TABLE "User" ADD COLUMN "surprise" TEXT',
      'surprise',
    ],
    ['a retired role', `ALTER TYPE "UserRole" ADD VALUE 'OWNER'`, 'UserRole'],
  ])(
    'refuses to mark the baseline over %s, and changes nothing',
    async (_what, change, named) => {
      const target = await unrecorded();
      await target.sql(change);
      const result = await target.migrate('deploy');
      expect(result.code).toBe(1);
      expect(result.output).toContain('REFUSED');
      expect(result.output).toContain(named);
      expect(await target.tableExists('_prisma_migrations')).toBe(false);
    },
  );

  it('refuses to apply anything over a schema changed by hand', async () => {
    const target = await database();
    expect((await target.migrate('deploy')).code).toBe(0);
    await target.sql('ALTER TABLE "User" ALTER COLUMN "name" DROP NOT NULL');
    const folder = build();
    addMigration(folder, 'CREATE TABLE "Never" (id int);');

    const result = await target.migrate('deploy', '--prisma-dir', folder);
    expect(result.code).toBe(1);
    expect(result.output).toContain('not what the migration history says');
    expect(await target.tableExists('Never')).toBe(false);
  });

  it('refuses a build older than the database', async () => {
    const target = await database();
    expect((await target.migrate('deploy')).code).toBe(0);
    const newer = build();
    addMigration(newer, 'SELECT 1;');
    expect((await target.migrate('deploy', '--prisma-dir', newer)).code).toBe(
      0,
    );

    const result = await target.migrate('deploy');
    expect(result.code).toBe(1);
    expect(result.output).toContain('older than the database');
  });

  it('refuses an applied migration that was edited', async () => {
    const target = await database();
    expect((await target.migrate('deploy')).code).toBe(0);
    const folder = build();
    appendFileSync(
      join(folder, 'migrations', BASELINE, 'migration.sql'),
      '\n-- edited\n',
    );
    const result = await target.migrate('deploy', '--prisma-dir', folder);
    expect(result.code).toBe(1);
    expect(result.output).toContain('was edited');
  });

  it('fails, rolls back and stays stopped until a failed migration is cleared', async () => {
    const target = await database();
    expect((await target.migrate('deploy')).code).toBe(0);
    const bad = build();
    addMigration(
      bad,
      'CREATE TABLE "Half" (id int);\nALTER TABLE "NoSuchTable" ADD COLUMN x int;\n',
    );

    const failed = await target.migrate('deploy', '--prisma-dir', bad);
    expect(failed.code).toBe(1);
    expect(await target.tableExists('Half')).toBe(false);

    const blocked = await target.migrate('deploy');
    expect(blocked.code).toBe(1);
    expect(blocked.output).toContain('started and did not finish');

    const recovered = await target.migrate(
      'recover',
      EXTRA,
      '--prisma-dir',
      bad,
    );
    expect(recovered.code).toBe(0);
    expect((await target.migrate('deploy')).code).toBe(0);
    expect((await target.history()).at(-1)).toEqual({
      name: EXTRA,
      applied: false,
      rolledBack: true,
    });
  });

  it('will not clear a failed migration that left changes behind', async () => {
    const target = await database();
    expect((await target.migrate('deploy')).code).toBe(0);
    const bad = build();
    addMigration(
      bad,
      'BEGIN;\nCREATE TABLE "Half" (id int);\nCOMMIT;\nALTER TABLE "NoSuchTable" ADD COLUMN x int;\n',
    );
    expect((await target.migrate('deploy', '--prisma-dir', bad)).code).toBe(1);

    const result = await target.migrate('recover', EXTRA, '--prisma-dir', bad);
    expect(result.code).toBe(1);
    expect(result.output).toContain('left changes behind');
    expect((await target.migrate('deploy', '--prisma-dir', bad)).code).toBe(1);
  });
});
