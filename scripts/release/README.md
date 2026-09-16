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
