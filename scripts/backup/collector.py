#!/usr/bin/env python3
"""Read-only, opt-in backup metadata collector; no payload or restore operations.

collect(cfg, s3, github, now) accepts injected list/head and GET-only clients and
returns health.evaluate input. monitor() returns only a redacted health summary.
CLI requires LINO_BACKUP_MONITOR_ENABLED=true, LINO_BACKUP_MONITOR_ENABLED_AT
(UTC), LINO_BACKUP_PROJECT_REF, R2_ENDPOINT_URL, R2_BUCKET, R2_ACCESS_KEY_ID,
R2_SECRET_ACCESS_KEY and GITHUB_TOKEN. Explicit false is disabled; an absent
switch is unconfigured. No production database or Supabase/Auth secret is read.
Only final complete markers with github-run-id/github-run-attempt metadata can
be correlated. Legacy, missing, duplicate or inconsistent evidence fails closed.
No restore receipt is manufactured; completion always retains the restore warning.
"""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.request
import urllib.parse

_SPEC = importlib.util.spec_from_file_location('backup_health', Path(__file__).with_name('health.py'))
health = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(health)
REPOSITORY = 'pony-soma/stylist-saas'
WORKFLOW = '.github/workflows/backup.yml'
API = 'https://api.github.com/repos/' + REPOSITORY
MAX_PAGES = 100
MAX_ITEMS = 10000
MAX_REQUESTS = 1000
MAX_SECONDS = 120


def require(ok):
    if not ok:
        raise ValueError('invalid collector evidence')


def number(value):
    require(type(value) in (int, str) and re.fullmatch(r'[1-9][0-9]{0,19}', str(value)))
    return str(value)


def stamp(value):
    if isinstance(value, dt.datetime):
        require(value.tzinfo is not None)
        value = value.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    health.timestamp(value)
    return value


def config(env):
    require(env.get('LINO_BACKUP_MONITOR_ENABLED') == 'true')
    ref = env.get('LINO_BACKUP_PROJECT_REF', '')
    require(re.fullmatch(r'[a-z]{20}', ref))
    endpoint = env.get('R2_ENDPOINT_URL', '')
    require(re.fullmatch(r'https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com', endpoint))
    bucket = env.get('R2_BUCKET', '')
    require(re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket))
    baseline = stamp(env.get('LINO_BACKUP_MONITOR_ENABLED_AT'))
    for key in ('R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'GITHUB_TOKEN'):
        require(bool(env.get(key)))
    return {'ref': ref, 'bucket': bucket, 'endpoint': endpoint, 'enabled_at': baseline}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('redirect refused')


class GitHub:
    """Fixed-origin JSON GET adapter; never follows API-supplied URLs."""
    def __init__(self, token):
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect)

    def get(self, path):
        require(re.fullmatch(r'/actions/(workflows/backup\.yml/runs\?branch=main&per_page=100&page=[1-9][0-9]*|runs/[1-9][0-9]*/attempts/[1-9][0-9]*(/jobs\?per_page=100&page=[1-9][0-9]*)?)', path))
        request = urllib.request.Request(API + path, method='GET', headers={
            'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'lino-backup-monitor'})
        with self.opener.open(request, timeout=10) as response:
            require(response.status == 200 and response.geturl() == API + path)
            raw = response.read(4 * 1024 * 1024 + 1)
        require(len(raw) <= 4 * 1024 * 1024)
        return json.loads(raw, object_pairs_hook=health.unique_object)


def collect(cfg, s3, github, now):
    """Bounded metadata reads. Exceptions mean unusable evidence, never success.

    Capturing now before reads intentionally rejects concurrent/future changes;
    callers can retry a later snapshot. Pagination inconsistency also fails closed.
    """
    now = stamp(now)
    baseline = stamp(cfg['enabled_at'])
    require(baseline <= now)
    deadline = time.monotonic() + MAX_SECONDS
    requests = 0

    def call(fn, **kwargs):
        nonlocal requests
        requests += 1
        require(requests <= MAX_REQUESTS and time.monotonic() < deadline)
        result = fn(**kwargs)
        require(time.monotonic() < deadline)
        return result

    def past(value):
        value = stamp(value)
        require(value <= now)
        return value

    prefix = 'lino-backup/v1/' + cfg['ref'] + '/'
    objects, token, tokens, markers, used = set(), None, set(), [], 0
    for _ in range(MAX_PAGES):
        args = {'Bucket': cfg['bucket'], 'Prefix': prefix, 'MaxKeys': 1000}
        if token is not None:
            args['ContinuationToken'] = token
        page = call(s3.list_objects_v2, **args)
        require(type(page.get('IsTruncated')) is bool)
        entries = page.get('Contents', [])
        require(type(entries) is list and len(entries) <= 1000)
        for obj in entries:
            key, size = obj['Key'], obj['Size']
            require(type(key) is str and key.startswith(prefix) and key not in objects)
            require(type(size) is int and size >= 0)
            past(obj['LastModified'])
            objects.add(key)
            require(len(objects) <= MAX_ITEMS)
            used += size
            require(used <= 2**63 - 1)
            if key.endswith('/complete.manifest.age'):
                require(re.fullmatch(re.escape(prefix) + r'runs/[A-Za-z0-9_-]{1,128}/complete\.manifest\.age', key))
                head = call(s3.head_object, Bucket=cfg['bucket'], Key=key)
                completed = past(head['LastModified'])
                require(completed == stamp(obj['LastModified']) and head['ContentLength'] == size and size > 0)
                require(head.get('ETag') == obj.get('ETag') and bool(head.get('ETag')))
                metadata = head['Metadata']
                require(all(re.fullmatch(r'[a-f0-9]{64}', metadata.get(k, '')) for k in ('cipher-sha256', 'plain-sha256')))
                rid = number(metadata['github-run-id']) + '_' + number(metadata['github-run-attempt'])
                markers.append({'run_id': rid, 'completed_at': completed})
        if not page['IsTruncated']:
            require(not page.get('NextContinuationToken'))
            break
        token = page.get('NextContinuationToken')
        require(type(token) is str and token and token not in tokens and entries)
        tokens.add(token)
    else:
        raise ValueError('pagination limit')

    runs, seen, total, retrieved, all_runs = [], set(), None, 0, {}

    def parse_run(run, expected_id=None, expected_attempt=None):
        rid, attempt = number(run['id']), number(run['run_attempt'])
        require(expected_id is None or rid == expected_id)
        require(expected_attempt is None or attempt == str(expected_attempt))
        require(run['repository']['full_name'] == REPOSITORY and run['head_branch'] == 'main')
        require(run['path'] == WORKFLOW)
        started = past(run['run_started_at'])
        status, conclusion = run['status'], run.get('conclusion')
        result = {'run_id': rid + '_' + attempt, 'started_at': started}
        if status == 'completed':
            require(conclusion in ('success', 'failure', 'cancelled', 'timed_out', 'action_required', 'skipped', 'neutral', 'stale', 'startup_failure'))
            result['status'] = 'success' if conclusion == 'success' else 'cancelled' if conclusion == 'cancelled' else 'failed'
            # Workflow updated_at is not a finish timestamp. Obtain actual job
            # completion timestamps for this exact attempt instead.
            finishes, job_ids, job_total = [], set(), None
            for job_page in range(1, MAX_PAGES + 1):
                jobs = call(github.get, path='/actions/runs/' + rid + '/attempts/' + attempt + '/jobs?per_page=100&page=' + str(job_page))
                count = jobs['total_count']
                require(type(count) is int and 0 < count <= MAX_ITEMS)
                require(job_total is None or count == job_total)
                job_total = count
                entries = jobs['jobs']
                require(type(entries) is list and len(entries) == min(100, count - len(job_ids)))
                for job in entries:
                    jid = number(job['id'])
                    require(jid not in job_ids and number(job['run_id']) == rid)
                    # Attempt identity is fixed in the requested endpoint.
                    # The documented jobs response may omit run_attempt.
                    if 'run_attempt' in job:
                        require(number(job['run_attempt']) == attempt)
                    require(job['status'] == 'completed')
                    job_ids.add(jid)
                    finishes.append(past(job['completed_at']))
                if len(job_ids) == count:
                    break
            else:
                raise ValueError('pagination limit')
            result['finished_at'] = max(finishes)
            require(started <= result['finished_at'])
        else:
            require(status in ('queued', 'in_progress', 'waiting', 'pending', 'requested') and conclusion is None)
            result['status'] = 'in_progress'
        require(result['run_id'] not in all_runs)
        all_runs[result['run_id']] = result
        if started >= baseline:
            runs.append(result)
        return rid, int(attempt)

    for page_number in range(1, MAX_PAGES + 1):
        page = call(github.get, path='/actions/workflows/backup.yml/runs?branch=main&per_page=100&page=' + str(page_number))
        count = page['total_count']
        require(type(count) is int and 0 <= count <= MAX_ITEMS)
        require(total is None or total == count)
        total = count
        entries = page['workflow_runs']
        require(type(entries) is list and len(entries) == min(100, total - retrieved))
        for run in entries:
            rid, attempt = parse_run(run)
            require(rid not in seen and attempt <= MAX_REQUESTS)
            seen.add(rid)
            for older in range(1, attempt):
                previous = call(github.get, path='/actions/runs/' + rid + '/attempts/' + str(older))
                parse_run(previous, rid, older)
        retrieved += len(entries)
        if retrieved == total:
            break
    else:
        raise ValueError('pagination limit')
    # Older evidence still must correlate; do not guess from object names or time.
    require(len({m['run_id'] for m in markers}) == len(markers))
    for marker in markers:
        run = all_runs.get(marker['run_id'])
        require(run is not None and run['status'] == 'success')
        require(run['started_at'] <= marker['completed_at'] <= run['finished_at'])
        require(not (run['started_at'] < baseline <= marker['completed_at']))
    markers = [m for m in markers if m['completed_at'] >= baseline]
    evidence = {'evaluated_at': now, 'expectation_enabled': True, 'enabled_at': baseline,
                'inventory': {'observed_at': now, 'complete': True, 'stored_bytes': used, 'markers': markers}, 'runs': runs}
    require(health.evaluate(evidence)['state'] != 'invalid')
    return evidence


def monitor(env, s3=None, github=None, now=None):
    flag = env.get('LINO_BACKUP_MONITOR_ENABLED')
    if flag == 'false':
        return {'state': 'disabled', 'reasons': ['expectation_disabled']}
    if flag is None:
        return {'state': 'unconfigured', 'reasons': ['expectation_missing']}
    try:
        cfg = config(env)
        if s3 is None:
            import boto3
            from botocore.config import Config
            s3 = boto3.client('s3', endpoint_url=cfg['endpoint'], aws_access_key_id=env['R2_ACCESS_KEY_ID'],
                              aws_secret_access_key=env['R2_SECRET_ACCESS_KEY'], region_name='auto',
                              config=Config(retries={'total_max_attempts': 1}, connect_timeout=5, read_timeout=10,
                                            s3={'addressing_style': 'path'}))
            def refuse_redirect(response=None, **kwargs):
                if response is not None:
                    require(not 300 <= response[0].status_code < 400)

            def fixed_origin(request, **kwargs):
                target = urllib.parse.urlsplit(request.url)
                expected = urllib.parse.urlsplit(cfg['endpoint'])
                require(target.scheme == expected.scheme and target.netloc == expected.netloc)

            s3.meta.events.register_first('needs-retry.s3', refuse_redirect)
            s3.meta.events.register_first('before-send.s3', fixed_origin)
        github = github if github is not None else GitHub(env['GITHUB_TOKEN'])
        return health.evaluate(collect(cfg, s3, github, now or dt.datetime.now(dt.timezone.utc)))
    except Exception:
        return {'state': 'invalid', 'reasons': ['collection_failed']}


def main():
    result = monitor(os.environ)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['state'] in ('healthy', 'disabled') else 2 if result['state'] in ('invalid', 'unconfigured') else 1


if __name__ == '__main__':
    sys.exit(main())
