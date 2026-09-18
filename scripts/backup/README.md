# Encrypted off-site backup — release candidate, disabled

Supabase Free stays unchanged. This implementation is NOT proof that production
can already be recovered. No R2 resources, real exports or schedules are created
by committing these files. `backup.yml` is manual-only, requires main, repository
variable `LINO_BACKUP_ENABLED=true`, and the `lino-backup` environment. Never run
it from a pull request or unreviewed branch. The existing main branch also deploys
the application: do not merge this PR just to enable the backup workflow.

## Data path

1. Validate project/DB endpoint, SSL, R2 endpoint, age public recipient and limits.
2. Export filtered Supabase roles/schema/data/history into a private tar package
   using the pinned CLI. See PLATFORM-EXPORT.md; hosted recovery gates remain.
3. Encrypt the archive with age before uploading it to a dedicated private R2
   Standard bucket. Only the age PUBLIC recipient goes in GitHub configuration.
4. Read `record-photos` metadata and download new/changed files. Encrypt every
   uploaded file. Unchanged versions can reuse existing opaque object keys.
5. Compare photo metadata before/after collection. Abort on observed changes.
6. Upload an encrypted manifest LAST, referencing the archive and photo versions.
   Incomplete runs without a manifest are not recovery points. Report only counts.
7. Clean temporary plaintext on process exit. Hosted runner teardown is an extra
   boundary, not a substitute for preventing logs or artifact uploads.

The worker reads Supabase and writes only the backup bucket. It does not restore
or delete source data and does not delete old backups. Raw file paths live only
inside encrypted manifests, not in R2 keys or workflow logs.

## Important limits before enabling

- Legacy generic `pg_dump` is a candidate DB archive, NOT a tested Supabase migration
  procedure. Managed roles, extensions, grants, migration history and custom
  auth/storage policies must be rehearsed against the chosen restore target.
  A dump does not include cluster-global roles/passwords, Auth provider settings,
  Stripe state, external service keys or the project's encryption root key.
- DB and Storage do not share one atomic snapshot. Comparing file metadata detects
  observed photo changes, not all DB writes or concurrent delete/recreate races.
  For release backup: freeze all write paths, drain requests, collect and validate
  reference consistency before calling the backup recoverable. For routine backup,
  design and test reference reconciliation and deletion grace periods first.
- The proposed 7 daily + 4 weekly DB copies and 30-day photo history are NOT yet
  enforced. Do not apply a simple R2 age-based deletion rule: a recent manifest may
  reference an older deduplicated photo. Retention needs reference-aware pruning.
  Initial version keeps everything and stops at its configured storage budget.
- Default limits: 100 MiB exported/downloaded plaintext per run, 1,000 photos and
  8 GiB stored ciphertext under this project's prefix. These are conservative
  failure limits, not a Cloudflare account-wide spend cap. Other projects and
  operations count toward provider free tiers; monitor Supabase egress as well.
- HTTP metadata/HEAD verification is not a full download/decrypt/restore test.
  Before first production export, rehearse the complete pipeline with dummy data
  in a private test bucket or a strictly isolated, unique rehearsal prefix containing only fabricated data, including a failed run and missing object.
- Only bounded SDK retries are enabled. No retention deletes, schedule, external notification or
  missed-run monitor is activated. Configure these after the recovery test.

## One-time setup (operator, before enabling)

1. Create/choose Cloudflare account and enable R2. Review billing requirements and
   actual account-wide usage. Create a dedicated **private Standard** bucket;
   disable r2.dev/public domains. Do not reuse a public media bucket.
2. Create R2 credentials restricted to that bucket. Worker needs list, HEAD and
   upload. Keep its credentials out of chat and source code.
3. Generate the age identity on the owner's trusted computer using `age-keygen`.
   Keep the private identity in an encrypted password vault plus a separately
   recoverable copy. Put ONLY the public `age1...` recipient in GitHub. Losing
   the private identity makes the backups unrecoverable. We do not generate the
   production private identity in this chat or ephemeral workspace.
4. Prepare the Supabase Session pooler connection (port 5432, not transaction
   port 6543), current DB password and Storage server credential. Do not reset
   production passwords as a convenience. An existing service-role key is broad:
   place it only in the protected backup environment; never expose it to PR jobs.
5. Configure the protected `lino-backup` GitHub environment and trusted branch
   rules. Only reviewed main may access its secrets; retain the main release gate.
6. Confirm PostgreSQL client 17 is compatible with the source server. The initial
   workflow uses `postgres:17.6-bookworm` and installs age from Debian. Pin the
   image digest/package provenance in the operational rollout review, and keep
   clients patched. Dependency pins are in requirements.txt.
7. Run dummy end-to-end backup and restore, finalize reference-aware retention and
   failure/missed-run monitoring. Only then enable real exports and scheduling.

### GitHub configuration map

Repository variable (gate): `LINO_BACKUP_ENABLED` — keep false/unset until ready.

Environment variables in `lino-backup`:

| Name | Value |
|---|---|
| LINO_BACKUP_PROJECT_REF | Approved Supabase reference |
| LINO_BACKUP_SUPABASE_URL | https://REFERENCE.supabase.co |
| LINO_BACKUP_AGE_RECIPIENT | Public age recipient; never the private identity |
| LINO_BACKUP_R2_ENDPOINT | https://ACCOUNT_ID.r2.cloudflarestorage.com |
| LINO_BACKUP_R2_BUCKET | Dedicated private Standard bucket |

Environment secrets:

- `LINO_BACKUP_PGHOST`, `LINO_BACKUP_PGUSER`, `LINO_BACKUP_PGPASSWORD`
- `LINO_BACKUP_STORAGE_KEY`
- `LINO_BACKUP_R2_ACCESS_KEY_ID`, `LINO_BACKUP_R2_SECRET_ACCESS_KEY`

`workflow_dispatch` also requires the exact project ref and rejects mismatch.
SSL mode is `require` initially (encrypted connection); use `verify-full` with a
trusted provider CA when configured and tested. Do not disable SSL to fix errors.

## Recovery review

On a trusted isolated recovery machine: download the encrypted completed manifest,
use the locally held age identity to decrypt it, download its DB archive and every
referenced photo version, verify recorded hashes, decrypt and validate. Reconcile
record/file references and missing files before restoring into an approved closed
recovery target. Never restore production Auth/customer data into the ordinary
staging project. Keep external messages/Stripe writes disabled. Reconcile Stripe
separately. See `scripts/release/RECOVERY.md` for the release recovery gates.

Official references checked 2026-09-17:
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://developers.cloudflare.com/r2/api/tokens/
- https://developers.cloudflare.com/r2/pricing/
- https://github.com/FiloSottile/age

## Dummy encrypted recovery rehearsal (2026-09-18 candidate)

`.github/workflows/backup-rehearsal.yml` exercises a disposable PostgreSQL database
and a fabricated PNG, never the production Supabase database or Storage. The
secret-free job first runs the full local roundtrip. The push-only R2 job receives
only the R2 access key pair and endpoint/bucket configuration; it receives neither
production DB/Storage credentials nor the owner's age private key. Both jobs use
a temporary age identity generated inside the job.

The R2 rehearsal uses `lino-backups` only under a fresh `lino-rehearsal/v1/UUID/`
prefix. The ordinary backup prefix is never read or changed. It uploads a tiny
encrypted archive, fabricated photo and encrypted manifest, downloads and
verifies them, restores into a second disposable DB, verifies rows/grants/RLS,
and deletes only the exact keys created by that attempt. Cleanup failures fail
the test rather than silently reporting success. Forced runner termination can
leave encrypted dummy objects; inspect that run's prefix before removing them.

This is a transfer/crypto/synthetic-restore test, not proof that the complete
LiNo Supabase schema, Auth identities or production photo references restore.
It also does not test the owner's production decryption key. Real backup,
retention and scheduling remain disabled. The `lino-backup` environment is
normally main-only: allow the reviewed release-preparation branch temporarily
only for the concrete test, then remove the temporary rule. Never merge main
just to run this test. Local CI results and actual R2 results are recorded
separately in the handover.

## Operational review and recovery

See [REVIEW-TOOLS.md](REVIEW-TOOLS.md) for the offline retention/health helpers,
[RECOVERY.md](RECOVERY.md) for the production-specific candidate runbook and
[OPERATIONS.md](OPERATIONS.md) for activation gates. No automatic deletion or
live monitoring is enabled by these additions.

The filtered default export and read-only monitoring collector are documented in
[PLATFORM-EXPORT.md](PLATFORM-EXPORT.md). Their workflows remain disabled.
