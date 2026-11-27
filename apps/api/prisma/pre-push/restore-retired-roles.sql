-- Rollback for remove-retired-roles.sql.
--
-- Earlier releases ask for `role IN ('ADMIN', 'OWNER')`, which PostgreSQL
-- rejects once OWNER is gone. Run this BEFORE starting an earlier api again,
-- then restart that api:
--
--   psql -v ON_ERROR_STOP=1 -U <user> -d <database> < restore-retired-roles.sql
--
-- It puts the two values back where they were in the order, which team lists
-- sort by, so the earlier schema matches again. It changes no rows: converted
-- people stay ADMIN or STAFF, which earlier releases treat the same way.
-- Running it again does nothing.

BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OWNER' BEFORE 'ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'VIEWER' BEFORE 'CUSTOMER';
COMMIT;
