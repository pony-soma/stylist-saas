#!/usr/bin/env python3
"""Offline backup evidence evaluator (standard library, no side effects).

CLI: python3 scripts/backup/health.py < inventory.json
Exit: 0 healthy or explicitly disabled; 1 warning/critical; 2 invalid/unconfigured.
Input is one JSON object (unknown keys and duplicate JSON keys are rejected):
  {"evaluated_at":"2026-09-18T12:00:00Z", "expectation_enabled":true,
   "enabled_at":"2026-09-17T00:00:00Z",
   "inventory":{"observed_at":"2026-09-18T12:00:00Z", "complete":true,
                "stored_bytes":0, "markers":[]},
   "runs":[], "restore_receipt":null}
Each run: {"run_id":"opaque-id", "started_at":UTC, "status":one of
  "success", "failed", "cancelled", "in_progress", "finished_at":UTC}.
finished_at is required for terminal runs and absent for in_progress.
Each marker: {"run_id":"opaque-id", "completed_at":UTC}; it represents an
observed complete.manifest.age, never a filename supplied to this program.
Optional external restore receipt: {"run_id":"opaque-id", "tested_at":UTC,
"result":"passed"}. It must match the latest successful completed run exactly,
and postdate completion. No receipt is created, authenticated or signed here.

UTC timestamps use YYYY-MM-DDTHH:MM:SSZ; no future timestamps are accepted.
The explicit evaluated_at makes evaluate(document) pure and deterministic;
operators must supply a trusted current clock and complete, trustworthy run
history and inventory. No live listing, decryption or authenticity verification
is performed. A supplied receipt is only reported as evidence, never proof that
future restores work. Completion alone is not evidence of tested restoration.

Policy: proposed daily cadence, warning after 24h without an attempt; critical
completion age >36h; inventory older than 1h prevents healthy; running >2h is
critical; capacity warning at >=80% of the existing 8 GiB cap. No scheduling,
notifications, credential reads, network access, writes, or deletion occur.
Disabled requires explicit false. Enabled without enabled_at is unconfigured.
Outputs contain generic states, reasons, counts, and ages, never supplied IDs.
"""
import datetime as dt
import json
import re
import sys

CAP_BYTES = 8 * 1024 ** 3
DAY = 86400


class InvalidInput(ValueError):
    pass


def require(condition):
    if not condition:
        raise InvalidInput()


def fields(value, required, optional=()):
    require(type(value) is dict)
    require(set(required) <= set(value) <= set(required) | set(optional))


def timestamp(value):
    require(type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value))
    return dt.datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)


def identifier(value):
    require(type(value) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value))
    return value


def evaluate(document):
    """Return redacted health summary; all malformed evidence fails closed."""
    try:
        return _evaluate(document)
    except (InvalidInput, ValueError, TypeError, KeyError, OverflowError):
        return {'state': 'invalid', 'reasons': ['invalid_input']}


def _evaluate(d):
    require(type(d) is dict)
    if 'expectation_enabled' not in d:
        return {'state': 'unconfigured', 'reasons': ['expectation_missing']}
    require(type(d['expectation_enabled']) is bool)
    fields(d, ['expectation_enabled', 'evaluated_at'], ['enabled_at', 'inventory', 'runs', 'restore_receipt'])
    now = timestamp(d['evaluated_at'])
    if not d['expectation_enabled']:
        return {'state': 'disabled', 'reasons': ['expectation_disabled']}
    if 'enabled_at' not in d:
        return {'state': 'unconfigured', 'reasons': ['enabled_baseline_missing']}

    def past(value):
        parsed = timestamp(value)
        require(parsed <= now)
        return parsed

    enabled = past(d['enabled_at'])
    require('inventory' in d and 'runs' in d)
    inv = d['inventory']
    fields(inv, ['observed_at', 'complete', 'stored_bytes', 'markers'])
    observed = past(inv['observed_at'])
    require(observed >= enabled)
    require(type(inv['complete']) is bool)
    require(type(inv['stored_bytes']) is int and 0 <= inv['stored_bytes'] <= 2**63 - 1)
    require(type(inv['markers']) is list and type(d['runs']) is list)
    require(len(inv['markers']) <= 10000 and len(d['runs']) <= 10000)
    runs = {}
    for run in d['runs']:
        fields(run, ['run_id', 'started_at', 'status'], ['finished_at'])
        rid = identifier(run['run_id'])
        require(rid not in runs)
        start = past(run['started_at'])
        require(enabled <= start <= observed)
        status = run['status']
        require(status in ('success', 'failed', 'cancelled', 'in_progress'))
        finish = None
        if status == 'in_progress':
            require('finished_at' not in run)
        else:
            finish = past(run['finished_at'])
            require(start <= finish <= observed)
        runs[rid] = (start, status, finish)
    markers = {}
    for marker in inv['markers']:
        fields(marker, ['run_id', 'completed_at'])
        rid = identifier(marker['run_id'])
        require(rid not in markers and rid in runs)
        completed = past(marker['completed_at'])
        start, status, finish = runs[rid]
        require(status == 'success' and start <= completed <= finish <= observed)
        markers[rid] = completed

    reasons, critical = [], False
    age = lambda value: int((now - value).total_seconds())
    latest = max(runs.values(), key=lambda run: run[0]) if runs else None
    # Tied latest starts are ambiguous; never hide a failure with ordering.
    latest_runs = [run for run in runs.values() if latest and run[0] == latest[0]]
    latest_id = max(markers, key=lambda rid: (markers[rid], rid)) if markers else None
    completion_age = age(markers[latest_id]) if latest_id else None
    if not inv['complete']:
        reasons.append('inventory_incomplete')
        critical = True
    if age(observed) > 3600:
        reasons.append('inventory_stale')
        critical = True
    if not runs:
        reasons.append('never_run')
        critical = True
    if age(latest[0] if latest else enabled) > DAY:
        reasons.append('daily_attempt_overdue')
    for status in ('failed', 'cancelled'):
        if any(run[1] == status for run in latest_runs):
            reasons.append('latest_attempt_' + status)
            critical = True
    if any(run[1] == 'in_progress' for run in runs.values()):
        reasons.append('attempt_in_progress')
    if any(run[1] == 'in_progress' and age(run[0]) > 7200 for run in runs.values()):
        reasons.append('attempt_overdue')
        critical = True
    if any(run[1] == 'success' and rid not in markers for rid, run in runs.items()):
        reasons.append('success_without_complete_marker')
        critical = True
    if latest_id is None:
        reasons.append('no_successful_complete_marker')
        critical = True
    elif completion_age > 36 * 3600:
        reasons.append('completion_stale')
        critical = True
    restore_state = 'not_tested'
    receipt = d.get('restore_receipt')
    if receipt is not None:
        fields(receipt, ['run_id', 'tested_at', 'result'])
        rid = identifier(receipt['run_id'])
        tested = past(receipt['tested_at'])
        require(receipt['result'] == 'passed')
        require(rid in markers and tested >= runs[rid][2])
        restore_state = 'supplied_receipt_matches_latest' if rid == latest_id else 'receipt_for_older_run'
    if restore_state != 'supplied_receipt_matches_latest':
        reasons.append('latest_restore_not_tested')
    if inv['stored_bytes'] >= CAP_BYTES:
        reasons.append('capacity_limit_reached')
        critical = True
    elif inv['stored_bytes'] * 5 >= CAP_BYTES * 4:
        reasons.append('capacity_warning')
    return {'state': 'critical' if critical else 'warning' if reasons else 'healthy',
            'reasons': reasons, 'restore_evidence': restore_state,
            'run_count': len(runs), 'complete_marker_count': len(markers),
            'inventory_age_seconds': age(observed),
            'latest_completion_age_seconds': completion_age,
            'latest_attempt_age_seconds': age(latest[0]) if latest else None}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def main():
    try:
        raw = sys.stdin.read(4 * 1024 * 1024 + 1)
        require(len(raw) <= 4 * 1024 * 1024)
        result = evaluate(json.loads(raw, object_pairs_hook=unique_object))
    except (ValueError, RecursionError, UnicodeError):
        result = {'state': 'invalid', 'reasons': ['invalid_input']}
    print(json.dumps(result, sort_keys=True))
    return 0 if result['state'] in ('healthy', 'disabled') else 2 if result['state'] in ('invalid', 'unconfigured') else 1


if __name__ == '__main__':
    sys.exit(main())
