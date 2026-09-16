# Initial production cutover (operator-only)

These programs **generate SQL only**. They neither connect to a database nor deploy.
They are deliberately outside `supabase/migrations`: the normal staging migration
chain must not attempt to rerun the initial production bootstrap.

`node scripts/release/build-cutover.cjs <verified-master-uuid>` emits a single
transaction. Resolve the approved owner from the intended project's Auth data;
never put email addresses, production UUIDs or credentials in this public repository.
The program rejects invalid UUIDs. SQL additionally requires the explicit session
marker `lino.release_approval = lino-initial-cutover-v1`, an existing verified Auth
account with a stylist row, and absence of the new billing/ownership tables.
**The marker is an operator mistake guard, not a replacement for user approval.**

The bundle establishes the protected billing table and functions, removes legacy
policies on ten application tables, then composes the six reviewed application
migrations with source SHA256s. All steps share one transaction. Only the specified
account becomes master. No sandbox customer/subscription identifiers are imported.
Auth rows, old subscription rows, customers, photos and medical records are kept.
Historical records retain a NULL owner and are invisible to all client roles,
including master. Existing bookings retain their explicit customer relationships.

`node scripts/release/build-cutover-rehearsal.cjs` emits a rollback-only synthetic
rehearsal for staging. It creates `lino_cutover_rehearsal` (fails if already present),
uses fabricated Auth rows, reconstructs the legacy schema and broad policies,
applies the generated cutover to that isolated schema, checks one master and an
ordinary tester, checks preserved/hidden historical records, and rolls back all
changes. Do not run against production. No production customer data is used.

## Verified / remaining

- Builder tests passed. Hosted staging synthetic SQL rehearsal passed 2026-09-16.
- An initial fixture failed its legacy NOT NULL requirement; fixed the fabricated
  customer's line_user_id and reran successfully. No production changes.
- Not yet an approved release: full production schema drift comparison, deploy
  downtime/compatibility, backup/restore rehearsal, private Storage configuration
  and policies, live Stripe Portal/Webhook/keys, public legal pages and release
  acceptance checks remain separate gates.
- Bucket settings are NOT changed by SQL. First use the explicit `--harden`
  option in `scripts/setup-private-photo-storage.cjs` with the approved target ref
  and `LINO_STORAGE_RELEASE_APPROVAL` set to that same ref. This operator mistake
  guard does not replace user approval. It makes the bucket private, caps files at
  10 MiB, restricts MIME types to JPEG/PNG/WebP, then reads the configuration back.
- Cutover SQL now requires the bucket already to be private and installs a
  RESTRICTIVE policy denying anon/authenticated direct access to record-photos.
  Existing permissive rules cannot override this policy. Other buckets retain
  their existing rules. Server-side ownership-checked APIs use service_role.
- The rehearsal models legacy permissive Storage policies in its own table and
  verifies SELECT/INSERT/UPDATE/DELETE denial plus unaffected other buckets.
  Actual HTTP object serving, old public URLs, CDN/browser caches and revocation
  of existing signed URLs still require separate release checks. Previously
  downloaded copies cannot be recalled by this change.
- Do not revert to the old app or permissive policies as an assumed safe rollback.
- Check production account approval/status separately. No real payment is made by
  these tools or tests.

## Public legal pages: release review still required

Draft pages `/terms`, `/privacy`, `/commercial-disclosure` are reachable before
login, and linked from the homepage, login and billing screens. Seller name and
support email were explicitly confirmed by the owner. No street address or phone
number is stored in this repository.

Before production approval:
- Confirm the operator can promptly disclose the real business address and phone
  by email upon request, before an applicant decides to subscribe. Omitting the
  website listing does NOT mean refusing disclosure. Establish a monitored inbox
  and keep the reply details privately; do not commit those details.
- Confirm the proposed no-prorated-refund rule and handling of duplicate charges,
  defects and statutory remedies. This is a draft policy, not an approved change.
- Review the privacy text against actual processors, transfers and retention
  operations. Do not assert legal compliance solely because pages exist.
- Verify public page access and links on staging; set the approved URLs in Stripe
  Checkout/Portal where applicable during the separately approved release.
- Check the Stripe final confirmation screen's price, trial end, renewal and
  cancellation terms; publishing these pages alone does not complete checkout
  disclosure or change consent-version enforcement.

Official basis checked 2026-09-16:
https://www.no-trouble.caa.go.jp/what/mailorder/
The CAA permits omission of certain advertising particulars only when prompt
provision on request is both stated and operationally possible. A business-use
contract may be outside statutory scope; this does not waive Stripe requirements.

## Read-only preflight and cutover order

Run `preflight.sql` against the explicitly identified legacy target. It opens a
read-only transaction, returns only counts/structure, then rolls back. Review all
result sets (some connectors return only the final one). Zero findings are needed
for orphan stylists, duplicated/invalid availability, invalid menu values and
invalid blocked intervals. Historical medical/photo/subscription counts are
preservation evidence, not rows to delete. This does not validate the entire
schema, backup availability, account identity or deploy authorization.

Initial cutover order to include in the final owner approval:
1. Confirm the exact release commit, approved legal/support/refund operations,
   target project IDs, verified master Auth UUID and live Stripe account status.
2. Confirm a recoverable backup and restore procedure covering PostgreSQL/Auth
   AND Storage objects; schema-only exports and a Vercel rollback are not backups.
3. Re-run schema/data preflight; stop for unreviewed drift. Capture current app,
   environment-variable names/targets and infrastructure configuration securely.
4. Close general access for the cutover window and hold new checkout creation.
   The current legacy app is not compatible with the new write restrictions.
   A maintenance mechanism still needs implementation/testing before release.
5. Prepare live Stripe price (JPY1980/month, explicit inclusive tax treatment),
   portal (period-end cancellation, payment updates, invoice history, approved
   policy links), webhook and matching production secrets. Never copy test IDs.
6. Harden the production photo bucket through the API, verify it is private,
   then apply the approved generated DB transaction (which requires privacy).
   Keep the migration's old-data preservation assertions enabled.
7. Build the approved app with PRODUCTION-specific environment values and deploy
   it to stylist-saas. Do not promote a staging artifact with baked-in public keys.
8. Verify master identity, anonymous/foreign-user denial, photo HTTP rejection,
   live webhook delivery and final checkout amounts/terms before opening access.
   A real charge is not an implicit part of this approval; agree a separate test
   payment/refund procedure if needed.
9. If a gate fails, keep access closed and reconcile database/deployment state.
   After new writes, do not blindly restore a backup or revert to old permissive
   RLS. Use a reviewed fix-forward or recover under an explicit recovery plan.

The API/code setup is not proof that Stripe has completed account review. Do not
mark a release ready just because a live Price exists or CI passes.
