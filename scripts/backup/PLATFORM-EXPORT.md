# Filtered platform export candidate

The default backup database payload is now `supabase-cli-platform-v1`: a tar
containing Supabase CLI **2.117.0** filtered `roles.sql`, `schema.sql`, `data.sql`,
a guarded `pre_restore.sql`,
optional migration-history schema/data and `package.json` with hashes and unresolved
restore gates. The outer object is still `database.age` and is encrypted with age
before upload. The completion manifest is format **2**, with explicit
`database_format`. Legacy `pg-custom-v1` remains format 1 and is opt-in only.
Never pass a format-2 tar to pg_restore. Retention accepts both known formats.

`platform_export.py` accepts only the configured hosted project, session/direct
connection on port 5432 with SSL, or the fixed synthetic local CI source. It
requires ordinary `postgres`, not a superuser. Passwords are passed in the child
environment, not CLI arguments. Unrelated credentials and PG connection override
variables are excluded. Plaintext is bounded, placed in owner-only temporary
storage, packaged with hashes, then encrypted by backup.py; export failure removes
its partial package. Production execution remains behind the existing disabled
main-only workflow. There is no release, schedule or permission change here.

A fresh Supabase target gives new public objects default grants that can be
broader than the source object's permissions. Applying the dump without clearing
those defaults was observed in synthetic CI to retain unwanted anonymous table
access and anonymous/authenticated function execution. The package therefore
requires `roles.sql`, **`pre_restore.sql`**, then `schema.sql` in a single
`psql -X --single-transaction -v ON_ERROR_STOP=1` restore. Apply optional
`history_schema.sql`, then `SET session_replication_role = replica`, `data.sql`,
and optional `history_data.sql` in that same transaction. The exact file order
is recorded in `package.json.restore_order`; verify each hash before execution.

The preparation SQL requires a non-superuser `postgres` and a fresh public schema;
it refuses existing public relations and non-extension functions/types. It rejects
global `postgres` default-privilege entries because a schema-local revoke cannot
remove globally granted privileges. It clears only `postgres` defaults in `public`
for tables, sequences, functions and types, covering every existing grantee. It
never deletes objects or changes auth/storage defaults. The source schema dump
then reinstates source public defaults after restoring object definitions and
permissions. CI compares default ACLs and actual table/function grants strictly;
it does not discard permission differences or rewrite system catalogs. Targets
with rejected global defaults require separate review before restoring.

Filtered exports improve compatibility but are separate database snapshots.
Application writes and in-flight external events must be quiesced for a recovery
point. The package itself always reports `hosted_restore_verified: false`:
custom auth/storage definitions, platform/service compatibility, encryption-root
key dependencies, Auth/SMTP/OAuth configuration and real hosted-target verification
still require review. Photo bytes follow the separate encrypted photo path.

The `platform-recovery` CI job invokes this actual export module against synthetic
LiNo data, restores via non-superuser postgres into a fresh second local Supabase,
then checks public definitions/ownership policies, managed definitions unchanged,
same-password login and cross-user denial. It does not drop managed schemas,
use a superuser, suppress SQL restore errors or contact hosted projects.
A local pass is not a claim of a complete hosted disaster-recovery exercise.

References: [Supabase filtered backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [PostgreSQL default ACL semantics](https://www.postgresql.org/docs/17/catalog-pg-default-acl.html), and [ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

# Read-only health collection candidate

`collector.py` combines paginated R2 metadata with the exact GitHub workflow
`pony-soma/stylist-saas/.github/workflows/backup.yml`, branch main. Each new final
marker carries `github-run-id` and `github-run-attempt`; intermediate objects do
not. GitHub retries are separate attempts. The collector uses actual job finish
times and refuses missing, ambiguous or inconsistent evidence. It only performs
R2 list/HEAD and fixed-origin GitHub GET requests; no encrypted body is fetched.

The collector passes evidence to `health.py` and prints only its redacted summary.
It never fabricates a restore receipt, so a successful fresh backup still carries
`latest_restore_not_tested`. Metadata-only collection cannot establish recovery.
Legacy markers without provenance are rejected, not guessed from timestamps.
Pagination, object/run counts, requests and elapsed time are bounded; limits or
missing GitHub history produce an invalid result requiring investigation.

The new `backup-health.yml` is manual-only, main-only and disabled unless the
repository variable `LINO_BACKUP_MONITOR_ENABLED=true`. Baseline variable
`LINO_BACKUP_MONITOR_ENABLED_AT` must be a trusted UTC start time. The environment
uses existing project/R2 configuration plus the workflow's read-only GitHub token;
no DB/Auth secret is supplied. Retention inventory is a separate, stricter format.

This workflow has not been run against live storage. No monitor variables were
set. It does not send notifications or establish independent missed-run monitoring.
Before activation: test real metadata collection on synthetic correlated evidence,
choose an independent execution/notification path, authorize its destination, and
verify failed and never-started backup scenarios. Main merge still needs release
approval; do not merge solely to activate this workflow.
