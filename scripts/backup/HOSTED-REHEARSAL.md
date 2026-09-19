# Hosted recovery rehearsal — synthetic verification completed

Updated 2026-09-19. The approved synthetic rehearsal was completed while retaining
Supabase Free. Production was neither changed nor copied. Staging was temporarily
paused and subsequently resumed with unchanged DB inventory and Auth settings.

## Verified rehearsal evidence

- Ordinary non-superuser postgres restored the reviewed INSERT fixture into an
  independent hosted target. Public catalog/grants/RLS/functions matched the source;
  managed Auth/Storage definitions matched their pre-restore state.
- Two synthetic users logged in with their original passwords. Customer/record
  ownership isolation and anonymous denial passed. A private 68-byte PNG roundtrip
  matched SHA-256; foreign-user access and direct object access were denied.
- CI run 35434227199 at commit fdc9fdd442be70350e278b326f6976604d7d19eb passed.
  Artifact 10581777555 ZIP SHA-256:
  `22b8a76136aa7d41afe1d7323b085e478e445fa9441b4f9e0a9087b9565235e5`.
- The owner-key synthetic roundtrip passed separately on the owner PC on 2026-09-19.
  No private identity was supplied to CI or this workspace.
- Target `dxssqmliuinyekkbnkuq` is paused. Staging resumed ACTIVE_HEALTHY at build
  17.6.1.166, with Auth health/settings and app pages responding successfully.
- This is synthetic INSERT transport evidence, not recovery of a production
  ciphertext snapshot or proof of every hosted service configuration.

## Capacity evidence

The connected organization is `vqqbvhgemimtysqfblag` (pony-soma's Org).
The project list reports two ACTIVE_HEALTHY projects:

| Role | Project | Reference | Database build |
|---|---|---|---|
| Production | stylist-saas | pprlqowossudjvtgkfir | 17.6.1.155 |
| Staging | lino-staging | kmwvfotrvhaddriebxur | 17.6.1.166 |

Three unrelated projects are INACTIVE. Do not repurpose or delete them.
The project cost endpoint returns **0 USD/month**, but this is not a capacity
reservation or confirmation that a third active Free project can be created.
Official billing documentation limits Free to two active projects across
organizations where the user is Owner/Administrator; paused projects do not count.
Creating another organization does not bypass that limit.

## Repeatable sequence while retaining Free

1. Retain the completed owner-key receipt. Repeat only if the key/configuration changes.
2. Continue synthetic local CI recovery; local tests complement the dated hosted
   evidence above; changes still require appropriate regression coverage.
3. Before a hosted rehearsal, prepare a staging maintenance window and inspect
   the platform's actual creation eligibility. Only after approval, temporarily
   pause **staging**, leave production running, and use the available slot for
   an independent `lino-recovery-rehearsal` project in Tokyo.
4. Populate only reviewed schema and synthetic identities/records/photos. No
   production auth.users, customer data, passwords, photos or service secrets.
   Disable outbound integrations and leave production routing unchanged.
5. Rehearse the actual export/import with ordinary postgres, compare platform
   versions, managed definitions, object/default grants and RLS. Verify same-key
   synthetic login, cross-user denial, and photo hashes/references. Capture a redacted result. The explicitly synthetic CI handoff may contain disposable
   fixture accounts for one day; never upload production SQL/Auth rows or keys.
6. Pause the synthetic target and resume staging. Verify staging login and app
   readiness. Record any restoration limitation or data-retention deadline from
   the platform at that time; do not assume paused projects persist indefinitely.

The completed lifecycle was explicitly approved. This runbook does not authorize
unrelated future interruptions or production restoration. Creating the
target must not proceed if the account requires payment or different conditions.
It also does not prove recovery of actual production records; that remains a
separate approved closed-target exercise. No automatic project lifecycle job is
enabled. Destructive cleanup of a hosted target requires its own review.

## Before activating actual backups

- Owner-key receipt, compatible hosted restore evidence and explicit remaining
  platform dependency decisions (Vault/root keys, Auth/SMTP/OAuth, custom managed
  definitions, role passwords).
- Writer freeze or tested DB/photo reconciliation and a trusted recovery receipt.
- Before unattended scheduling: test the read-only collector against correlated
  synthetic R2/GitHub evidence and independent failed/never-started monitoring;
  select and authorize a notification path. These are separate from a supervised
  first manual snapshot, which must not be labelled an unattended service.
- Concrete reviewed main release, production configuration differences and
  rollback plan, followed by the owner's final release approval.

Source: [Supabase billing and Free project limits](https://supabase.com/docs/guides/platform/billing-on-supabase).
Live project listing and cost response were read on 2026-09-19.
