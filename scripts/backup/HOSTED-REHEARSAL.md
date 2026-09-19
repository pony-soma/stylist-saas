# Hosted recovery rehearsal plan — not executed

Reviewed 2026-09-19. Keep Supabase Free. No project was created, paused, deleted,
upgraded, or populated as part of this review.

## Current capacity evidence

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

## Recommended sequence while retaining Free

1. Complete the owner's offline key check now, with no cloud changes.
2. Continue synthetic local CI recovery; current filtered recovery passes as
   ordinary postgres, but this is not hosted recovery evidence.
3. Before a hosted rehearsal, prepare a staging maintenance window and inspect
   the platform's actual creation eligibility. Only after approval, temporarily
   pause **staging**, leave production running, and use the available slot for
   an independent `lino-recovery-rehearsal` project in Tokyo.
4. Populate only reviewed schema and synthetic identities/records/photos. No
   production auth.users, customer data, passwords, photos or service secrets.
   Disable outbound integrations and leave production routing unchanged.
5. Rehearse the actual export/import with ordinary postgres, compare platform
   versions, managed definitions, object/default grants and RLS. Verify same-key
   synthetic login, cross-user denial, and photo hashes/references. Capture only
   a redacted result; never upload SQL/auth rows/keys as CI artifacts.
6. Pause the synthetic target and resume staging. Verify staging login and app
   readiness. Record any restoration limitation or data-retention deadline from
   the platform at that time; do not assume paused projects persist indefinitely.

This sequence is a proposal, not authorization to stop staging. Creating the
target must not proceed if the account requires payment or different conditions.
It also does not prove recovery of actual production records; that remains a
separate approved closed-target exercise. No automatic project lifecycle job is
enabled. Destructive cleanup of a hosted target requires its own review.

## Before activating actual backups

- Owner-key receipt, compatible hosted restore evidence and explicit remaining
  platform dependency decisions (Vault/root keys, Auth/SMTP/OAuth, custom managed
  definitions, role passwords).
- Writer freeze or tested DB/photo reconciliation and a trusted recovery receipt.
- Read-only collector tested against synthetic correlated R2/GitHub evidence;
  independent failed/never-started monitoring and an authorized notification path.
- Concrete reviewed main release, production configuration differences and
  rollback plan, followed by the owner's final release approval.

Source: [Supabase billing and Free project limits](https://supabase.com/docs/guides/platform/billing-on-supabase).
Live project listing and cost response were read on 2026-09-19.
