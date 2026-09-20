-- Read-only, one result set. No row content, SQL text, credentials or client IPs.
-- An empty activity sample is NOT evidence that writes are disabled.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT jsonb_build_object(
  'format', 'lino-write-path-inventory-v1',
  'observed_at', statement_timestamp(),
  'read_only', current_setting('transaction_read_only'),
  'freeze_verified', false,
  'activity_visibility', jsonb_build_object(
    'superuser', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
    'read_all_stats', pg_has_role(current_user, 'pg_read_all_stats', 'USAGE')),
  'other_sessions', (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM (
    SELECT backend_type, state, count(*) AS sessions,
      count(*) FILTER (WHERE xact_start IS NOT NULL) AS open_transactions,
      max(extract(epoch FROM statement_timestamp() - xact_start)) AS oldest_transaction_seconds
    FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
    GROUP BY backend_type, state ORDER BY backend_type, state
  ) s),
  'relation_locks', (SELECT coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) FROM (
    SELECT n.nspname AS schema, k.mode, k.granted, count(*) AS locks
    FROM pg_locks k JOIN pg_class c ON c.oid = k.relation
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE k.database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND k.pid IS DISTINCT FROM pg_backend_pid()
      AND n.nspname IN ('public', 'auth', 'storage')
    GROUP BY n.nspname, k.mode, k.granted ORDER BY n.nspname, k.mode, k.granted
  ) l),
  'prepared_transactions', (SELECT count(*) FROM pg_prepared_xacts WHERE database = current_database()),
  'writer_roles', (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM (
    SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
    WHERE rolcanlogin OR rolbypassrls OR rolsuper ORDER BY rolname
  ) r),
  'scheduler_extension_present', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'),
  'cron_job_table_present', to_regclass('cron.job') IS NOT NULL,
  'http_extension_present', EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('pg_net', 'http')),
  'public_security_definer_functions', (SELECT count(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef),
  'custom_trigger_counts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT n.nspname AS schema, count(*) AS triggers FROM pg_trigger g
    JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT g.tgisinternal AND n.nspname IN ('public', 'auth', 'storage')
    GROUP BY n.nspname ORDER BY n.nspname
  ) t)
) AS inventory;
ROLLBACK;
