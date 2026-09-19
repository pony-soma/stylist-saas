-- Read-only structure inventory. No customer/Auth rows, keys or role passwords.
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'postgres_version', current_setting('server_version'),
  'extensions', (SELECT jsonb_agg(jsonb_build_object('name',extname,'version',extversion) ORDER BY extname) FROM pg_extension),
  'schemas', (SELECT jsonb_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'),
  'roles', (SELECT jsonb_agg(t) FROM (SELECT rolname,rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname) t),
  'managed_policies', (SELECT jsonb_agg(t) FROM (SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('auth','storage') ORDER BY schemaname,tablename,policyname) t),
  'noninternal_triggers', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname) ORDER BY n.nspname,c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('public','auth','storage')),
  'publications', (SELECT jsonb_agg(t) FROM (SELECT pubname,puballtables FROM pg_publication ORDER BY pubname) t),
  'publication_tables', (SELECT jsonb_agg(t) FROM (SELECT pubname,schemaname,tablename FROM pg_publication_tables ORDER BY pubname,schemaname,tablename) t)
);
COMMIT;
