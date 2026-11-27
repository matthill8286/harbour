-- Removes the retired OWNER and VIEWER values from the "UserRole" type.
--
-- Run it once on a database that still has them, BEFORE `prisma db push`, with
-- the api stopped. `db push` refuses to remove enum values by itself.
--
--   psql -v ON_ERROR_STOP=1 -U <user> -d <database> < remove-retired-roles.sql
--
-- It converts OWNER to ADMIN and VIEWER to STAFF in every column of that type,
-- and deletes no rows. It is one transaction, so it all happens or none of it
-- does. Running it again, or on a database without the old values, does
-- nothing. To go back, see restore-retired-roles.sql.

BEGIN;

-- Fail rather than wait behind something that is still using the tables.
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  role_type oid := to_regtype('"UserRole"');
  col record;
  converted bigint;
BEGIN
  IF role_type IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = role_type AND enumlabel IN ('OWNER', 'VIEWER')
  ) THEN
    RAISE NOTICE 'No retired roles in "UserRole". Nothing to do.';
    RETURN;
  END IF;

  CREATE TYPE "UserRole_without_retired" AS ENUM ('ADMIN', 'STAFF', 'CUSTOMER');

  -- Read from the catalogue, so no column of the type can be missed. An array
  -- column or a default would make DROP TYPE below fail and undo everything.
  FOR col IN
    SELECT a.attrelid::regclass AS table_name, a.attname AS column_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE a.atttypid = role_type
      AND c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attinhcount = 0
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s WHERE %I::text IN (''OWNER'', ''VIEWER'')',
      col.table_name, col.column_name
    ) INTO converted;
    -- Converting and changing the type in one step rewrites each row once.
    EXECUTE format(
      'ALTER TABLE %1$s ALTER COLUMN %2$I TYPE "UserRole_without_retired" USING (
         CASE %2$I::text
           WHEN ''OWNER'' THEN ''ADMIN''
           WHEN ''VIEWER'' THEN ''STAFF''
           ELSE %2$I::text
         END
       )::"UserRole_without_retired"',
      col.table_name, col.column_name
    );
    RAISE NOTICE '%.%: converted % rows', col.table_name, col.column_name, converted;
  END LOOP;

  DROP TYPE "UserRole";
  ALTER TYPE "UserRole_without_retired" RENAME TO "UserRole";
END
$$;

COMMIT;
