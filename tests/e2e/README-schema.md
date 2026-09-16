# Disposable E2E database baseline

`setup-schema.sql` reproduces the original staging structural bootstrap, including all 11 baseline tables, constraints, deny-only business-table permissions, self-only stylist/billing reads, and the service-only `acquire_billing_lock` function. It creates the private `record-photos` bucket with the same 10 MiB limit and JPEG/PNG/WebP allowlist as staging. It contains no user records, Stripe identifiers, credentials, or uploaded photos.

The baseline comes from the preserved staging bootstrap. Its column definitions and billing function were cross-checked against read-only staging metadata on 2026-09-16. Subsequent application changes are taken directly from the tracked migration files, not duplicated here.

## Apply order

Use a **new local Supabase instance**. The runner must reject non-loopback API and database URLs. Execute with SQL errors treated as fatal:

1. `tests/e2e/setup-schema.sql`
2. Every `supabase/migrations/*.sql` whose filename timestamp is at least `20260913224403`, sorted by filename.
3. The rollback-based checks under `supabase/tests/`, before creating browser fixtures.
4. Synthetic users through the local Auth admin API, followed by synthetic test data.

Do not also apply the May-July migrations: their historical baseline lacks tables and columns that were added outside migration history. This fixture is deliberately **not** a production migration or a claim that the old migration history can recreate production. It aborts if any public table already exists.

The same application RPCs, RLS policies and browser/API code are exercised against real local Postgres/Auth/Storage. Hosted service configuration, Google OAuth, Stripe network calls, deployed environment variables and production data migration remain separate release checks.
