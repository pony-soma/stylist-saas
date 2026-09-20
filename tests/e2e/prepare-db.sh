#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ "${LINO_E2E_LOCAL:-}" != 1 ]]; then
  echo 'Refusing setup outside the isolated E2E environment.' >&2
  exit 1
fi
# A fixed local Docker container, never a URL supplied by the caller.
psql_local() {
  docker exec -i supabase_db_lino-e2e psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}
psql_local < tests/e2e/setup-schema.sql
for migration in supabase/migrations/*.sql; do
  if [[ "$(basename "$migration")" > '20260913224402' ]]; then
    echo "Applying $(basename "$migration")"
    psql_local < "$migration"
  fi
done
# Rehearse the legacy-to-current cutover with synthetic data; always rolls back.
node scripts/release/build-cutover-rehearsal.cjs | psql_local
for check in supabase/tests/*.rollback.sql; do
  echo "Checking $(basename "$check")"
  psql_local < "$check"
done
psql_local -c "NOTIFY pgrst, 'reload schema';"
