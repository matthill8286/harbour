/**
 * The one-time SQL that removes the retired roles, and its rollback, run the
 * way a release runs them. Skipped unless TEST_DATABASE_URL is set. It makes
 * and drops its own database, so that user needs CREATEDB.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;

const apiRoot = join(__dirname, '../..');
const schemaPath = join(apiRoot, 'prisma/schema.prisma');
const sqlPath = (name: string) => join(apiRoot, 'prisma/pre-push', name);
const REMOVE = sqlPath('remove-retired-roles.sql');
const RESTORE = sqlPath('restore-retired-roles.sql');

describeWithDatabase('removing the retired roles from a database', () => {
  jest.setTimeout(60_000);

  const name = `roles_${randomUUID().replace(/-/g, '')}`;
  let scratchUrl: string;
  let admin: PrismaClient;
  let db: PrismaClient;
  let folder: string;
  /** This schema as it was before: the same, with the two old values. */
  let oldSchema: string;

  const prismaCli = (args: string[], target = scratchUrl) =>
    execFileSync('pnpm', ['exec', 'prisma', ...args], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: target },
      encoding: 'utf8',
      stdio: 'pipe',
    });
  const push = (schema: string) =>
    prismaCli(['db', 'push', '--skip-generate', '--schema', schema]);
  const runSql = (file: string) =>
    prismaCli(['db', 'execute', '--url', scratchUrl, '--file', file]);

  const query = <T>(sql: string) => db.$queryRawUnsafe<T[]>(sql);
  const labels = async () =>
    (
      await query<{ label: string }>(
        `SELECT unnest(enum_range(NULL::"UserRole"))::text AS label`,
      )
    ).map((row) => row.label);
  const rolesIn = async (table: string) =>
    (
      await query<{ id: string; role: string }>(
        `SELECT id, role::text AS role FROM "${table}" ORDER BY id`,
      )
    ).map((row) => `${row.id}=${row.role}`);

  /** Fresh connections, as the api has after a restart. */
  async function reconnect() {
    await db?.$disconnect();
    db = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
  }

  beforeAll(async () => {
    const target = new URL(url!);
    target.pathname = `/${name}`;
    scratchUrl = target.toString();
    admin = new PrismaClient({ datasources: { db: { url: url! } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE ${name}`);

    folder = mkdtempSync(join(tmpdir(), 'harbour-roles-'));
    oldSchema = join(folder, 'schema.prisma');
    const current = readFileSync(schemaPath, 'utf8');
    const before = current.replace(
      /enum UserRole \{[^}]*\}/,
      'enum UserRole {\n  OWNER\n  ADMIN\n  STAFF\n  VIEWER\n  CUSTOMER\n}',
    );
    expect(before).not.toBe(current);
    writeFileSync(oldSchema, before);

    push(oldSchema);
    await reconnect();
    // Two workspaces, each with members and invites holding the old values.
    for (const org of ['a', 'b']) {
      await db.$executeRawUnsafe(
        `INSERT INTO "Organisation" (id, name, slug, "updatedAt") VALUES ('${org}', '${org}', '${org}', now())`,
      );
      for (const role of ['OWNER', 'ADMIN', 'STAFF', 'VIEWER', 'CUSTOMER']) {
        const id = `${org}-${role.toLowerCase()}`;
        await db.$executeRawUnsafe(
          `INSERT INTO "User" (id, email, name, "updatedAt") VALUES ('${id}', '${id}@example.test', '${id}', now())`,
        );
        await db.$executeRawUnsafe(
          `INSERT INTO "OrganisationMembership" (id, "organisationId", "userId", role, "updatedAt") VALUES ('${id}', '${org}', '${id}', '${role}', now())`,
        );
        await db.$executeRawUnsafe(
          `INSERT INTO "StaffInvite" (id, "organisationId", "userId", role, "tokenHash", "expiresAt") VALUES ('${id}', '${org}', '${id}', '${role}', '${id}', now())`,
        );
      }
    }
  });

  afterAll(async () => {
    await db?.$disconnect();
    await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.$disconnect();
    if (folder) rmSync(folder, { recursive: true, force: true });
  });

  const converted = ['a', 'b'].flatMap((org) => [
    `${org}-admin=ADMIN`,
    `${org}-customer=CUSTOMER`,
    `${org}-owner=ADMIN`,
    `${org}-staff=STAFF`,
    `${org}-viewer=STAFF`,
  ]);

  it('is needed, because db push alone refuses', () => {
    expect(() => push(schemaPath)).toThrow(/accept-data-loss/);
  });

  it('converts every column and keeps every row', async () => {
    runSql(REMOVE);
    await reconnect();

    await expect(labels()).resolves.toEqual(['ADMIN', 'STAFF', 'CUSTOMER']);
    await expect(rolesIn('OrganisationMembership')).resolves.toEqual(converted);
    await expect(rolesIn('StaffInvite')).resolves.toEqual(converted);
  });

  it('can be run again', async () => {
    runSql(REMOVE);
    await expect(rolesIn('StaffInvite')).resolves.toEqual(converted);
  });

  it('leaves db push with nothing to lose', () => {
    // Without --accept-data-loss, so any such change would fail here.
    expect(push(schemaPath)).toContain('in sync');
  });

  it('changes nothing if any part of it fails', async () => {
    runSql(RESTORE);
    await reconnect();
    await db.$executeRawUnsafe(
      `UPDATE "OrganisationMembership" SET role = 'OWNER' WHERE id = 'a-owner'`,
    );
    // A column the type change cannot follow, so dropping the old type fails.
    await db.$executeRawUnsafe(
      `CREATE TABLE "RoleList" (roles "UserRole"[] NOT NULL)`,
    );

    expect(() => runSql(REMOVE)).toThrow();

    await reconnect();
    await expect(labels()).resolves.toHaveLength(5);
    await expect(rolesIn('OrganisationMembership')).resolves.toContain(
      'a-owner=OWNER',
    );
    await db.$executeRawUnsafe(`DROP TABLE "RoleList"`);
    runSql(REMOVE);
  });

  it('can be rolled back, so an earlier api works again', async () => {
    const earlierQuery = () =>
      query(
        `SELECT id FROM "OrganisationMembership" WHERE role IN ('ADMIN', 'OWNER')`,
      );
    await reconnect();
    await expect(earlierQuery()).rejects.toThrow(/invalid input value/);

    runSql(RESTORE);
    runSql(RESTORE);
    await reconnect();

    await expect(earlierQuery()).resolves.toHaveLength(4);
    await expect(labels()).resolves.toEqual([
      'OWNER',
      'ADMIN',
      'STAFF',
      'VIEWER',
      'CUSTOMER',
    ]);
    // The earlier schema matches the database again.
    expect(push(oldSchema)).toContain('already in sync');
    // And the release can be tried again afterwards.
    runSql(REMOVE);
    expect(push(schemaPath)).toContain('in sync');
  });
});
