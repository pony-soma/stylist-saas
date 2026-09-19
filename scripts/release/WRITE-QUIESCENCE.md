# Cutover write quiescence

Status: inventory verified read-only on production and staging on 2026-09-19.
Full write exclusion is NOT implemented or verified. This is an operator plan,
not authorization to change production or evidence of an atomic snapshot.

## Evidence collected

`write-path-inventory.sql` returns one JSON result inside a read-only transaction.
It excludes customer rows, query text, credentials and IP addresses. Run it on
the explicitly selected project, retain the timestamp, and check visibility.
The `writer_roles` field lists login/BYPASSRLS candidates, not effective write
privileges; it deliberately includes a read-only role. Do not revoke this list.

Both hosted samples had read_all_stats=true, zero observed open transactions,
zero prepared transactions and zero public SECURITY DEFINER functions. No
pg_cron extension/cron.job table or HTTP extension was installed in either DB.
Background cron/net workers still appeared: a worker name is not evidence of
an application job. Storage had four noninternal triggers. These are transient
observations, not proof that future requests or external jobs cannot write.

## Required controls and acceptance evidence

| Path | Control to establish before capture | Verification in synthetic rehearsal |
| --- | --- | --- |
| Current app | Compatible maintenance deployment, checkout creation closed | Domain/API/OAuth/webhook return 503; public legal pages readable |
| Old deployments/open clients | Inventory reachable deployments and direct API clients; block their write path at the service boundary | Previously opened client and old URL cannot mutate |
| Data API/RPC | Review role grants, policies, privileged RPC and service-key callers; define a reversible write restriction | Anonymous, signed-in and service caller write attempts fail; backup reads work |
| Auth | Identify sign-up, login/refresh, admin actions and provider callbacks; establish supported service-level control | Auth writes cannot race capture; restore of original settings succeeds |
| Storage | Identify standard/resumable/S3 uploads, signed upload URLs, overwrite/delete and privileged callers; close ingress and drain existing operations | Start upload before closure and attempt overwrite/delete after closure; confirm outcome and unchanged restored bytes |
| DB clients/jobs | Suspend application jobs, migrations and owner scripts; inspect sessions and prepared transactions | No admitted writer during capture; any observation gap aborts consistency claim |
| External events | Hold application delivery without acknowledging success; record pending work | Reconcile and replay idempotently after reopening; no duplicate effects |

Do not describe these controls as available until the relevant platform setting
or implementation has been inspected and tested. In particular, a DB firewall
or app-only flag must not be assumed to cover Auth/Storage HTTPS APIs.

## Capture and reopen sequence

1. Record exact project IDs, release SHA, previous settings and deployment IDs,
   scope of the maintenance window, backup destination and recovery target.
2. Rehearse the above controls using fabricated data. Stop if any write route is
   unaccounted for; no automatic production changes follow a passing inventory.
3. Obtain concrete production-operation approval. Close entry points, stop jobs,
   drain admitted work and collect inventory with sufficient stats visibility.
4. Maintain the controls throughout roles/schema/data and photo export. Record
   start/end evidence and abort on drift, lost control or unexplained writes.
   The existing exporter uses separate dumps and keeps atomic_snapshot=false.
5. Decrypt and restore in the closed recovery target. Reconcile DB references,
   object bytes and hashes. Stable listings alone do not establish consistency.
6. Apply the separately approved cutover while access remains closed. Verify
   access isolation and production-specific configuration before reopening.
7. Restore only reviewed service settings, reconcile webhook backlog and confirm
   normal operations. Do not restore legacy permissive policies after migration.

Stripe can continue its billing schedule during application maintenance. A 503
holds delivery for retry; it does not pause charges. No real charge is included
in this plan. An incident before cutover should restore recorded settings; an
incident after schema/data changes requires the reviewed fix-forward/recovery
plan, not an automatic old-app rollback.

## Why a table lock alone is insufficient

PostgreSQL SHARE locks can block table DML while allowing ordinary reads, but
they end with their transaction. They do not freeze separate object storage,
sequence values or external service state. Locking managed Storage metadata
does not prove an in-flight object upload has stopped. Do not add triggers to
managed Auth/Storage tables, terminate managed sessions or revoke managed-role
permissions as a shortcut.

References checked 2026-09-19:
- https://www.postgresql.org/docs/17/explicit-locking.html
- https://supabase.com/docs/guides/storage/schema/design

Next implementation gate: establish and test supported ingress controls for
Auth and Storage, including existing upload requests. Until then the full
quiescence path remains blocked; the completed synthetic recovery tests remain
valid within their documented scope.

## Distinguish a candidate backup from an exact cutover recovery point

PostgreSQL pg_dump can take a consistent database snapshot while transactions
continue. This does not make our separate role/schema/history exports and
external photo bytes a single snapshot. Do not require Auth shutdown solely
to claim the documented pg_dump property, or use that property to claim a
zero-loss cutover recovery point. See https://www.postgresql.org/docs/17/app-pgdump.html.

A separately approved candidate capture may be evaluated by isolated restore
and photo reconciliation, with its actual scope and missing guarantees stated.
It must not automatically satisfy the release rollback gate: source changes
after capture, schema drift, sequence state, external billing and photo version
races still require controls or explicit recovery handling. The existing release
gate and production-operation approval remain in force.

Photo ciphertext reuse now requires a fresh source download and matching hash.
Every downloaded photo counts toward the existing per-run plaintext limit.
Same metadata with different bytes fails without replacing any old photo or
publishing a new completion marker. This closes a reuse blind spot; it does not
establish source quiescence or prove the old stored ciphertext is undamaged.

## 2026-09-20 bounded lock experiment (not a production freeze)

Read-only production inspection confirms ordinary `postgres` has UPDATE
privilege on all ten public tables, Auth data tables and Storage objects/buckets.
The exceptions are managed migration tables and vector-storage tables. The
earlier schema-wide privilege summary must not be interpreted as inability to
lock `auth.users` or `storage.objects` specifically.

`scripts/backup/capture-lock.mjs` is an experimental primitive with no CLI,
scheduled caller or production activation. It uses one transaction and bounded
SHARE-lock acquisition; failures roll back. It verifies the same connection's
actual locks and relation inventory. It excludes named platform migration and
vector tables, rejects populated vectors and otherwise refuses inaccessible
relations. It never changes managed grants, triggers or data. An idle timeout
limits abandoned sessions. This is not a complete capture/cutover coordinator.

`tests/e2e/capture-lock.mjs` runs only against the fixed disposable CI Supabase.
It verifies ordinary SQL writes, HTTP photo overwrite/delete, a pre-issued signed
upload token and login, alongside stable readable photo bytes and resumption.
It also checks that timed-out HTTP writers have left the server lock queue;
client-side cancellation alone is not evidence of a drained server operation.

CI run 35451737637 passed the primitive, pre-issued signed upload and TUS
overwrite admitted before acquisition, along with the existing browser suite
(10 checks). The tested source is a disposable local stack, not hosted production.
CI run 35452918895 also passed the expanded lock rehearsal: standard S3
overwrite/delete, multipart completion admitted before acquisition, and bounded
acquisition failure when an existing writer holds a conflicting lock. The
rehearsal verified unchanged photo bytes, drained server lock queues and normal
operation after release. S3 signing uses STORAGE_S3_REGION, not SERVER_REGION.

Still required before using this candidate for a release: hosted
service/version compatibility, sequence and administrative-DDL controls, lifetime
supervision through capture/restore/cutover, and the separately approved production
window. Do not set `atomic_snapshot=true` or claim global source quiescence from
these tests. A background object-deletion worker is not stopped by table locks.

The upstream implementation inspected at Supabase Storage
`5d79e291ef9017c57ef261afca0a16429d1c8240` uses version-specific object locations
and transactional metadata changes. This is a hypothesis to test, not proof that
the hosted service uses this revision or that all deletion races are covered.
