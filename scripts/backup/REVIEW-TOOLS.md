# Backup retention and health review tools

These are offline, standard-library evaluators. They do not fetch cloud data,
schedule backups, send alerts or delete anything. Their synthetic tests run in
the existing `Backup safety and encryption tests` CI job.

## Retention proposal

`retention.py` consumes a complete, quiescent inventory and **all** complete
manifests decrypted locally by their owner. Preserve original decrypted JSON
bytes so the recorded plaintext hash can be checked. Never upload these inputs
to GitHub, chat or CI artifacts. No private key is passed to this tool.

```sh
python3 scripts/backup/retention.py --project-ref APPROVED_REF --inventory inventory.json --manifests decrypted-manifests
```

Input format is documented in the module docstring. Inventory includes opaque
object keys, lengths, UTC modification times and stored cipher/plain hashes;
it must be no older than one hour. A future, incomplete, non-quiescent, unknown
or mismatched input fails closed, emitting an empty candidate list. Inventory
completeness and quiescence are operator assertions; hashes must originate from
trusted collection. The tool does not independently verify cloud bytes.

Proposed conservative policy:

- Keep every complete snapshot from the last 30 days; this deliberately stores
  more DB points than only 7 daily + 4 weekly, to retain associated photo history.
- Also keep the latest point for each of the last 7 observed UTC dates and last
  4 observed ISO weeks. Sparse histories may retain much older points.
- Keep every photo referenced by any retained snapshot, regardless of its age.
- Preserve objects within 48 hours, including the boundary. A recent incomplete
  run blocks all candidate pruning. Require every complete manifest/reference.

Thirty days refers to captured recovery points, not a guarantee of 30 days after
an unobserved source deletion. Gaps in collection cannot reconstruct missing
history. Output contains only opaque keys, counts and reasons. It is a proposal,
not an executable deletion plan. No delete switch exists. Before implementing
live deletion: authenticated fresh inventory, shared lock with the writer,
revalidation immediately before deleting, candidate grace and restore evidence
must all be designed and tested. Do not use an age-only R2 lifecycle rule.

## Backup health evaluation

```sh
python3 scripts/backup/health.py < health-evidence.json
```

Exact schema is in the module docstring. This input differs from retention input:
health needs collection time, used bytes, observed completion markers, run history,
explicit enabled state/baseline and optional externally supplied restore receipt.
Use a trusted current clock. Unknown/duplicate fields and future evidence are
rejected. No cloud collector is implemented by this helper.

| Condition | Result |
| --- | --- |
| Explicitly not enabled | disabled, never healthy |
| Missing enabled baseline | unconfigured |
| Never executed / latest failed or cancelled | critical |
| No attempt for more than 24 hours | warning (or critical for another fault) |
| No complete marker / completion older than 36 hours | critical |
| Incomplete inventory or observation older than 1 hour | critical |
| Running for more than 2 hours | critical |
| At least 80% of 8 GiB / at least 8 GiB | warning / critical |
| No restore receipt for latest completed run | warning |

A completion marker establishes uploaded completion only. A supplied receipt must
match the exact run and follow completion; this helper cannot authenticate it or
prove restoration. `healthy` means supplied evidence satisfies this policy, not
that the evaluator performed a restore. Disabled and healthy both exit 0; always
read `state`. Warning/critical exit 1; invalid/unconfigured exit 2.

Run-history collection must distinguish deliberately expired retention points from
missing recent markers; the evaluator fails closed if a supplied successful run
has no corresponding marker. Collection, correlation of GitHub attempts with
backup run IDs, independent scheduling/monitoring of missed runs, and notification
delivery remain to be connected and tested. No notification destination is set.

## Current operation

Production backup enablement, automatic pruning and monitoring are still **off**.
These tools require no new user credentials, plan upgrade or manual setup now.
They are reviewed building blocks for the gated rollout in `OPERATIONS.md` and
`RECOVERY.md`; passing their tests does not mean live monitoring has started.
