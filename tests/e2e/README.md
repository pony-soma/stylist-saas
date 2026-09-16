# Automated browser verification

The `Browser E2E (isolated Supabase)` check runs automatically on every update to a pull request targeting `main`, alongside unit/API mock tests, TypeScript and build checks. Results are visible on the PR's **Checks** tab and in **Actions → LiNo validation**. Failed jobs can be rerun there. `workflow_dispatch` is included for use once this workflow exists on the default branch.

Every run creates a disposable local Supabase (Postgres, Auth and private Storage) on the GitHub runner, applies the staging structural baseline and current migrations, verifies the SQL permission checks, builds the actual application, and drives Chromium at desktop and mobile sizes. No Supabase/Stripe/Vercel/GitHub secret setup is needed. Auth users, passwords, data and pictures are synthetic and the containers are removed after the run. This workflow does not deploy or merge anything.

Coverage:

- Customer registration through the UI and DB ownership.
- Medical record creation and a real generated PNG upload.
- Reload persistence, authenticated image display and denied anonymous/public access.
- Record edit and persisted revision.
- Photo deletion, completed recovery ledger, absent DB reference and absent Storage object.
- Existing rollback SQL checks for ownership, billing expiry and server-side mutations.

The HTML report and failure screenshots are available as the `browser-e2e-report` artifact for seven days. Open its `index.html` after downloading, or run `npx playwright show-report` locally. Credentials, session files, video and network traces are not recorded. Any assertion failure makes the check fail; there are no automatic retries hiding failures.

## Limits and release process

This tests real app/DB/Auth/Storage integration in an **isolated CI environment**, not the deployed `lino-staging.vercel.app`. Google OAuth, hosted environment variables/redirect configuration, live Stripe/webhooks and LINE require separate staging integration checks. The test fixture creates confirmed users through the official local Auth admin API and signs them in through the password API; no login bypass is added to the application.

CI success alone does not authorize production. Continue with staging deployment/configuration checks, report results and request the owner's explicit production approval. Repository branch protection is a separate configuration; merely adding this workflow does not enforce a merge block.

## Local developer execution (Docker required)

Use a clean checkout with no hosted `.env.local` file. The test harness permits only fixed localhost addresses. The `tests/e2e/supabase` project must never be linked to a hosted project.

1. `npm ci --ignore-scripts`
2. `npx playwright install --with-deps chromium`
3. `npx supabase start --workdir tests/e2e`
4. Set `LINO_E2E_LOCAL=1`, `NEXT_PUBLIC_BASE_URL=http://localhost:3000`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, and the two **local** keys from `npx supabase status --workdir tests/e2e`. Never use hosted keys.
5. `bash tests/e2e/prepare-db.sh` (fresh DB only).
6. `npm run build && npm run test:e2e`
7. `npx supabase stop --workdir tests/e2e --no-backup`

See [README-schema.md](README-schema.md) for baseline provenance and the legacy migration gap.
