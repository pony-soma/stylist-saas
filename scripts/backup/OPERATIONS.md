# Backup operational rollout gates

Supabase Free is retained. This document is a rollout checklist, not evidence
that recurring backups or production recovery have been enabled.

## Verified foundations

- Private Standard R2 bucket configured by the owner.
- Owner generated the age identity on their own Windows machine, checked
  decryption of its passphrase-encrypted copy and reported separate safekeeping.
- Production DB SELECT 1, Storage listing and R2 HEAD succeeded in GitHub Actions.
- Synthetic DB/photo encryption, R2 roundtrip, restored rows/grants/RLS, wrong-key
  rejection, missing-object handling and exact trial-object cleanup succeeded.
- Environment normally allows only main; temporary release branch permissions
  were removed after each hosted test. Main also deploys the app: do not merge
  solely to activate backup workflows.

## Offline review helpers (implemented, not connected)

`retention.py` produces reference-aware dry-run candidates only; `health.py`
evaluates supplied freshness/failure/capacity/restore evidence. No cloud collector,
scheduler, live deletion or external alert is active. See `REVIEW-TOOLS.md`.
The catalog-only production survey and hosted recovery gaps are in `RECOVERY.md`.

## Before the first production snapshot

1. Verify the actual LiNo release schema, Auth identities and photo references
   through the isolated two-Supabase rehearsal. This covers repository schema,
   not a fresh audit of every managed production object/configuration.
2. Inventory hosted extensions/roles, custom auth/storage policies, migration
   history, Auth providers/URLs, Vault/root-key dependencies and Storage metadata.
   PostgreSQL native dumps alone do not preserve every service setting. Adapt
   the restore commands to the target's managed permissions before using them.
3. Test one fabricated object encrypted with the owner's configured public key
   and have the owner decrypt it locally. The private identity must not be placed
   in GitHub or this workspace. Ephemeral CI key success is not this test.
4. Define a closed restore target and a practical recovery time objective. Never
   restore production Auth/customer data into ordinary staging or send emails,
   LINE messages or Stripe writes from a recovery test.
5. Verify schema/version compatibility and source/reference consistency. A
   release snapshot needs all write paths stopped and in-flight writes drained,
   including direct Supabase and external webhook flows. The page maintenance
   flag alone is not a database write freeze.
6. Obtain the user's concrete release/production-operation approval where
   required, then collect a manual snapshot. Verify bytes, decrypt with the
   separately held key, and reconcile record-photo references at the closed
   restore target before labelling it recoverable.

## Before scheduling daily backups

- Initial proposed retention is 7 daily + 4 weekly DB points and 30 days of
  deleted/overwritten photo history. NOT implemented/enforced yet. A retained
  manifest can refer to older deduplicated photo objects, so deleting objects
  by age alone is unsafe. Pruning must compute all retained references first,
  offer a dry-run, and preserve a grace period for interrupted runs.
- Monitor last verified successful snapshot, age, bytes, photo count and capacity.
  A job failure alert alone misses a job which never started. Use independent
  missed-run detection and test the failure and missing-run alerts before rollout.
  Notification channel is not selected; no external messages are authorized.
- A daily interval can lose roughly one day's changes; delays/failures extend it.
  Select acceptable data loss and recovery time based on operational needs.
- Keep the current 100MiB/run, 1000-photo and 8GiB-prefix failure limits until
  usage justifies a reviewed change. They are not an account-wide billing cap.
  Track R2 operations/storage, Supabase egress and GitHub Actions usage together.
- Automatic retries must not publish an incomplete snapshot as complete. Recovery
  must redownload and verify contents rather than trusting object HEAD metadata.
- Freeze inputs or implement reference reconciliation plus deletion grace for
  routine snapshots; a before/after Storage listing is not a DB+photo transaction.
- Do not enable LINO_BACKUP_ENABLED or add cron until these gates are recorded.

## Cost and upgrade decisions

Do not upgrade Supabase automatically. Revisit Pro when capacity/egress approaches
limits, recovery time requirements tighten or maintenance effort grows. Pro does
not remove the need to back up Storage file contents separately.
