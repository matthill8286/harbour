-- Describes the structure of the current schema, one line per object, for comparing
-- two databases. It only reads. migrate.cjs runs it, and so can psql:
--
--   psql -X -At -f schema-fingerprint.sql
--
-- Each migration folder's schema.snapshot is this output after that migration.
-- Column order is left out, because a database that grew through `db push` has
-- columns in a different order from a new one. Enum order is kept. Objects that
-- belong to an extension (PostGIS) and Prisma's own history table are left out.
WITH ns AS (
  SELECT oid, quote_ident(nspname) || '.' AS prefix
  FROM pg_namespace WHERE nspname = current_schema()
),
extension_objects AS (
  SELECT classid, objid FROM pg_depend WHERE deptype = 'e'
),
relations AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity
  FROM pg_class c JOIN ns ON c.relnamespace = ns.oid
  WHERE c.relname <> '_prisma_migrations'
    AND NOT EXISTS (
      SELECT 1 FROM extension_objects e
      WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid
    )
),
types AS (
  SELECT t.* FROM pg_type t JOIN ns ON t.typnamespace = ns.oid
  WHERE NOT EXISTS (
    SELECT 1 FROM extension_objects e
    WHERE e.classid = 'pg_type'::regclass AND e.objid = t.oid
  )
),
lines AS (
  SELECT format('relation %s kind=%s rowsecurity=%s', relname, relkind, relrowsecurity) AS line
  FROM relations WHERE relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  UNION ALL
  SELECT format('column %s.%s %s notnull=%s default=%s identity=%s generated=%s collation=%s',
    r.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
    coalesce(pg_get_expr(d.adbin, d.adrelid), '-'),
    nullif(a.attidentity, ''), nullif(a.attgenerated, ''),
    coalesce((SELECT collname FROM pg_collation WHERE oid = a.attcollation), '-'))
  FROM relations r
  JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
  WHERE r.relkind IN ('r', 'p', 'v', 'm', 'f')
  UNION ALL
  SELECT format('view %s %s', relname, md5(pg_get_viewdef(oid)))
  FROM relations WHERE relkind IN ('v', 'm')
  UNION ALL
  SELECT format('index %s valid=%s %s', r.relname, i.indisvalid, pg_get_indexdef(i.indexrelid))
  FROM pg_index i JOIN relations r ON r.oid = i.indrelid
  UNION ALL
  SELECT format('constraint %s.%s validated=%s %s', r.relname, c.conname, c.convalidated, pg_get_constraintdef(c.oid))
  FROM pg_constraint c JOIN relations r ON r.oid = c.conrelid
  UNION ALL
  SELECT format('trigger %s.%s enabled=%s %s', r.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN relations r ON r.oid = t.tgrelid
  WHERE NOT t.tgisinternal
  UNION ALL
  SELECT format('enum %s (%s)', t.typname, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder))
  FROM types t JOIN pg_enum e ON e.enumtypid = t.oid
  GROUP BY t.typname
  UNION ALL
  SELECT format('domain %s %s', typname, format_type(typbasetype, typtypmod))
  FROM types WHERE typtype = 'd'
  UNION ALL
  SELECT format('function %s(%s) %s', p.proname, pg_get_function_identity_arguments(p.oid), md5(p.prosrc))
  FROM pg_proc p JOIN ns ON p.pronamespace = ns.oid
  WHERE NOT EXISTS (
    SELECT 1 FROM extension_objects e
    WHERE e.classid = 'pg_proc'::regclass AND e.objid = p.oid
  )
)
-- The schema's own name is removed, so the result is the same whatever it is called.
SELECT cleaned.line
FROM (
  SELECT replace(lines.line, ns.prefix, '') AS line FROM lines CROSS JOIN ns
) AS cleaned
ORDER BY cleaned.line COLLATE "C"
