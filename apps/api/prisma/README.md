# The database

`schema.prisma` describes the tables, and `migrations/` holds the SQL that builds them.
A release changes the database only by applying those migrations. Nothing uses `db push`.

## Local development

```bash
pnpm db:deploy       # apply the migrations
pnpm db:seed         # optional demo data
pnpm db:status       # say what db:deploy would do, changing nothing
```

A database that you built with `db push` before migrations existed needs no special step.
`pnpm db:deploy` marks the baseline as applied if the database matches it exactly. If it
refuses, it lists what differs. Rebuild a database you can afford to lose with
`pnpm --filter @vip/api prisma:reset`, which drops it, applies the migrations and seeds it.

## Changing the schema

1. Start from the latest `main`, with a local database that `pnpm db:deploy` accepts.
2. Edit `schema.prisma`.
3. Write the migration without applying it:
   `pnpm db:migrate -- --create-only --name <what_it_does>`
4. Read the new `migration.sql`, and edit it where needed. Prisma writes a rename as a drop
   and an add, which loses data, and it writes no backfill.
5. Write its snapshot: `pnpm db:snapshot`
6. Apply it: `pnpm db:deploy`, then `pnpm db:generate`.
7. Commit `schema.prisma`, the new folder with `migration.sql` and `schema.snapshot`, and
   the code together.

CI runs `pnpm db:check-migrations`. It fails when `schema.prisma` changes without a
migration, or when a snapshot is wrong. CI also fails a pull request that edits, renames or
removes a migration that is already on the target branch, or adds one that sorts before it.

`db:snapshot` and `db:check-migrations` build and drop a scratch database, so the
`DATABASE_URL` user needs `CREATEDB`.

### A schema change that was started before migrations existed

Do this on the branch that changes `schema.prisma`, once the baseline is on `main`. If that
branch merged first, with no migration, do the same on a new branch from `main`; step 1 is
then already done, and `main` fails `db:check-migrations` until this is merged. Do not
release `main` in that state, because the api would expect columns that no migration makes.

1. Merge `main` into the branch: `git merge origin/main`.
2. Keep the branch's `schema.prisma` changes.
3. Build a new local database from `main`'s migrations. Create an empty database, point
   `DATABASE_URL` in `apps/api/.env` at it, and run `pnpm db:deploy`. A database the branch
   already changed with `db push` no longer matches the baseline.
4. Follow steps 3 to 7 above. The new folder is the first migration after the baseline.
   Do not add it to the baseline.
5. Run `pnpm db:check-migrations`.
6. Replace any `prisma db push` instruction that the branch added to its spec files or docs
   with `pnpm run db:deploy`.

If two branches each add a migration, the one that merges second merges `main`, renames its
folder so that it sorts last, and runs `pnpm db:snapshot` again.

### Rules for a migration

- **Keep the previous api working.** The migration runs while the old api is serving, and a
  rollback keeps the new schema. Add first, and remove in a later release.
- **Do not write `BEGIN` or `COMMIT`.** PostgreSQL then undoes the whole file if any
  statement fails.
- A new required column needs a default or a backfill in the same file.
- `ALTER TYPE ... ADD VALUE` cannot be used by a later statement in the same file. Use the
  new value in the next migration.
- Long locks stall the live api. Keep backfills small.

## Indexes that schema.prisma cannot describe

They belong in migrations. The baseline makes the two partial unique indexes that
`GpsIndexesService` used to make when the api started:
`Tracker_realImei_key` and `LocationEvent_trackerId_recordedAt_key`. The service now only
checks that both exist, and stops the start if one does not. Prisma ignores partial
indexes, so it neither drops them nor notices if one is missing. The snapshots do.

## What a release does

The migrate image runs `node prisma/migrate.cjs deploy`. It takes a database lock, then:

| The database                                    | What happens                                           |
| ----------------------------------------------- | ------------------------------------------------------ |
| is empty                                        | all migrations are applied                             |
| has no history and matches the baseline exactly | the baseline is marked as applied, once; then the rest |
| has no history and differs                      | refused                                                |
| has history and matches it                      | pending migrations are applied                         |
| differs from what its history says              | refused                                                |
| has a migration this build does not have        | refused, because the build is older                    |
| has a failed migration                          | refused until it is resolved                           |

It also refuses a migration that was edited after it was applied. After applying, it checks
the schema again and fails if it is not the expected one. A refusal changes nothing.

The comparison uses `schema-fingerprint.sql`, a read-only query of the PostgreSQL catalogs.
It covers tables, columns, enums, indexes, constraints, triggers and functions. It ignores
column order, extension objects and other schemas. It does not compare data, grants or
ownership. `node prisma/migrate.cjs check` makes the same decision without changing anything.

## A failed migration

The release stops before it replaces the api, so the old api keeps running. PostgreSQL has
undone the file's statements, and Prisma has recorded the failure. All later deploys refuse.

1. Read the error in the release output.
2. Using the same image that failed, run
   `node prisma/migrate.cjs recover <migration name>`.
   It marks the migration as rolled back only if the schema is exactly what it was before.
3. If it says changes were left behind, restore the dump taken before the release, or repair
   the schema by hand and run `recover` again.
4. Fix the migration and release again. A migration that never succeeded may be edited. If it
   had already reached `main`, CI blocks the edit, so replace its SQL only after agreeing to
   skip that check for this one pull request.

## Rolling back

Rolling back the api and web images keeps the database as it is. Migrations are not
reversed. Earlier apis ignore the `_prisma_migrations` table. An api from before
migrations, including `2ab6201`, runs on a baselined database. Its migrate image still
runs `db push`, so do not run that image against a database that has later migrations.

Releasing an older build again is refused. Use the rollback command instead.

## pre-push

`pre-push/` holds the one-time SQL that removed the `OWNER` and `VIEWER` roles while
releases still used `db push`. The baseline already includes that change. The SQL is needed
only to go back to an api from before it. After running `restore-retired-roles.sql`, deploys
refuse until `remove-retired-roles.sql` has run again.
