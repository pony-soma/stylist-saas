# Supervised candidate capture without a main merge

Prepared 2026-09-20. Implementation for review; no launch tag or approval variable
has been created and no production capture has been run by this change.

## Purpose and limit

`candidate-capture.yml` is triggered by a narrowly named tag push. GitHub loads
push workflows from the pushed revision, so this path does not require putting
the workflow on main merely to expose workflow_dispatch. It invokes the existing
encrypted exporter, using the existing protected `lino-backup` environment.
The workflow contains no application deploy, restore or migration operation.

This captures a **candidate** for closed recovery evaluation. It does not invoke
the experimental capture lock, stop writers, or declare a zero-loss cutover
point. `atomic_snapshot` stays false. Before/after object listing and fresh photo
hash checks do not make the separate dumps and photo bytes one transaction.
Final source quiescence and preservation through cutover remain unresolved.

## Exact approval package, before execution

1. Review the whole selected commit, including workflows and dependency lock;
   confirm CI for its executable files. Record the full 40-character commit SHA.
2. Obtain owner approval for production read/export of DB/Auth and photo bytes
   into the already configured private encrypted R2 destination. No private age
   identity enters CI or this workspace. This approval does not include public
   release, source writes, a real charge or restore into an ordinary environment.
3. Review all Git/Vercel integrations and the current production deployment to
   ensure the chosen tag cannot cause an unrelated deployment. This workflow's
   absence of deployment commands does not prove external integration behavior.
4. In GitHub environment `lino-backup`, retain existing protections and add only
   the **exact tag** below to the permitted tag policy for this window. Require
   the owner review supported by the repository plan; no broad branch/tag bypass.
   Protect that exact tag against movement/deletion/recreation. The code rejects
   workflow reruns, but is not a durable once-only ledger against tag recreation.
5. Set these nonsecret environment variables after choosing the UTC window:

| Variable | Required value |
| --- | --- |
| LINO_CANDIDATE_CAPTURE_ENABLED | true |
| LINO_CANDIDATE_ACK | candidate-only-not-cutover-recovery |
| LINO_CANDIDATE_APPROVED_SHA | Reviewed full commit SHA |
| LINO_CANDIDATE_APPROVED_REF | refs/tags/lino-candidate-YYYYMMDDTHHMMSSZ-SHA12 |
| LINO_CANDIDATE_EXPIRES_UTC | UTC timestamp YYYY-MM-DDTHH:MM:SSZ, at most one hour after tag timestamp |

`SHA12` is the first twelve characters of that same commit. Existing target,
public recipient and R2 variables/secrets remain in the protected environment;
never copy their secret values into the repository, chat or local files.
The source must be `pprlqowossudjvtgkfir` and the existing exporter additionally
validates the database host, user, Supabase URL, encryption recipient and limits.

6. Create only that lightweight tag at the approved commit. Review and approve
   the waiting protected job. The helper verifies creation event, matching
   target/ref/SHA, first run attempt and current deadline before setup, then
   again immediately before capture. A late start fails closed. The deadline
   controls permission to start; the separate 30-minute job limit bounds runtime.
7. Record the exact run and encrypted snapshot identity. A transfer success is
   not a recovery receipt. Do not rerun an expired/failed launch or recreate its
   tag; inspect failure and obtain a new reviewed window/tag if needed.
8. Disable LINO_CANDIDATE_CAPTURE_ENABLED and remove the temporary exact-tag
   environment permission after success, failure or cancellation. Keep the tag
   protected as evidence. Do not enable LINO_BACKUP_ENABLED or daily scheduling.

## Closed restore remains a separate user operation

The owner keeps the decryption identity on their own computer. The existing
closed recovery target is paused; opening capacity requires a separately
approved staging pause/resume window on the Free plan. Before importing actual
Auth/customer data, prove the recovery endpoint cannot serve normal users or
send outbound messages. The prior synthetic restore is not evidence of this
production-data isolation. Record actual DB/photo hashes and references on
restore, including any missing service configuration. Never use ordinary staging
or public GitHub artifacts to transport the decrypted data.

References: GitHub [push events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)
and [environment protections](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
