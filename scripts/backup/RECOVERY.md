# LiNo recovery runbook — candidate, not activated

Updated 2026-09-19. Production is `pprlqowossudjvtgkfir` (`stylist-saas`);
ordinary staging is `kmwvfotrvhaddriebxur`. Neither is a restore target in this
runbook. Supabase Free is retained. Recovery target creation and production
cutover require a concrete reviewed plan and the owner's release approval.

## Read-only production inventory

The 2026-09-19 read-only inspection confirmed PostgreSQL **17.6** and extensions
`plpgsql 1.0`, `pg_stat_statements 1.11`, `uuid-ossp 1.1`, `pgcrypto 1.3`,
`supabase_vault 0.3.1`. Vault being installed does not establish whether encrypted
values are in use. A separate aggregate-only query returned zero vault.secrets
rows and zero public functions on 2026-09-19. This narrows the observed Vault
dependency but does not inventory external credentials; no secret values or
customer/Auth records were inspected.
Schemas: auth, extensions, graphql, graphql_public, public, realtime, storage,
vault. No supabase_migrations schema appeared in this inventory.

`postgres` is not a superuser; the platform's `supabase_admin` is reserved.
The legacy archive CI used its own local Docker administrator. The separate
filtered-export CI uses ordinary postgres. Do **not** transfer the legacy
schema-drop procedure to hosted Supabase or attempt to obtain its admin key.

The production record-photos bucket was public=true with no size/MIME limits
on 2026-09-19. Current production Storage policies still include `Public Access` for SELECT on
record-photos and authenticated-role INSERT/UPDATE/DELETE without owner checks.
These are legacy policies, not the release candidate's server-only photo model.
Preserve their definitions as incident evidence; do not reapply them blindly when
restoring a post-release snapshot. Match the snapshot's application/schema version
and apply the reviewed privacy migration before serving users. This inspection
made no policy or bucket changes and did not inspect photo contents.

Non-internal triggers in public/auth/storage were the four managed Storage
triggers: update_objects_updated_at, enforce_bucket_name_length_trigger,
protect_buckets_delete, protect_objects_delete. The supabase_realtime publication
exists with no publication tables in this snapshot. Refresh the inventory before
recovery; this is not a permanent statement about the production configuration.
`recovery-inventory.sql` repeats the read-only catalog collection.

## Release gate and restore sequence

1. **Identify the recovery point.** Record source project, immutable code commit,
   migration version, run ID, UTC capture window, writer-freeze evidence and chosen
   restore target. Both the filtered package and legacy generic archive remain
   recovery candidates until the target-specific gates pass. The encrypted
   manifest's atomic_snapshot=false remains true.
2. **Close the target.** Use a separate approved target with no users, outbound
   mail/LINE calls, live Stripe writes or publicly exposed app traffic. Never copy
   production records into normal staging. Choose matching Postgres/service
   versions and verify supported extension versions; do not assume requested
   extension pins were applied.
3. **Recover encryption material locally.** Owner retains the age private identity.
   Download ciphertext and verify cipher hashes; decrypt locally, then verify plain
   hashes and the complete manifest. No private key, decrypted dump, manifest,
   Auth record or photo goes in GitHub, chat, CI artifacts or a public share.
   A dummy object encrypted to the owner's configured public key must first pass
   local decryption; CI's ephemeral key is insufficient evidence.
4. **Build a platform-compatible package.** Use the Supabase CLI's filtered
   roles/schema/data export route and explicitly account for custom auth/storage
   definitions, migration history and Vault/root-key dependencies. Inventory
   compatibility and required settings must be confirmed before capture. The
   default runner now emits this filtered package (see PLATFORM-EXPORT.md), but
   the hosted-specific gates remain unresolved. Do not
   silently skip failed objects or label its local-admin restore as hosted proof.
5. **Restore into the closed target.** Review exact SQL and permitted ownership,
   restore with stop-on-error, and keep failure atomic where supported. Preserve
   managed schemas; no DROP auth/storage/realtime on a hosted target. Restore
   private buckets and photo bytes using Storage APIs. Resolve duplicate files
   explicitly. Reapply the reviewed app policies for that snapshot version.
6. **Verify before routing users.** Schema/grants/RLS/functions comparison;
   expected row counts and record-photo references; every restored file hash;
   synthetic login and cross-user denial; expired plan restriction; correct
   production price configuration; no external calls during validation. Record
   checks and exact run ID in a trusted recovery receipt. A transfer completion
   marker does not create such a receipt.
7. **Switch only after approval.** Prepare environment-variable changes, Auth
   provider/callback URLs, Stripe webhook destination and signing-secret changes,
   rollback route and a read-only reconciliation of external billing state. The
   database restore must never recreate Stripe charges. Users may need to sign in
   again after key/project changes. Release approval precedes any production
   route/configuration change. Observe errors and reconcile missed events before
   removing the write freeze.

## Remaining evidence before production enablement

- Synthetic hosted INSERT restoration, target lifecycle within Free and owner-key
  roundtrip are complete: see HOSTED-REHEARSAL.md for dated evidence and limits.
- Production-format COPY integration passed in CI run 35436817152 at commit
  ba61b8bd9390d2e53f55d022cf4bc9bbd50f243b, alongside INSERT and legacy recovery.
  Actual production snapshot decryption/reconciliation and production Auth
  provider/SMTP settings still need evidence.
- Vault currently contains zero rows, but review external configuration and any
  newly introduced encryption dependencies before each actual recovery.
- Writer freeze and DB/photo consistency across the real capture remain unverified.
- Retention and health helpers are offline review tools; live deletion, scheduled
  collection, independent missed-run monitoring and external alerts are not active.

Official references checked 2026-09-18:
[Supabase backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[platform-to-self-hosted caveats](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
[extension version pinning](https://supabase.com/changelog/extension-version-pinning-ignored),
[managed Realtime schema](https://supabase.com/changelog/realtime-schema-locked-down-against-modification).
