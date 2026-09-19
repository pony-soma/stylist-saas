import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('collector', Path(__file__).resolve().parents[1] / 'scripts/backup/collector.py')
c = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(c)
NOW = '2026-09-18T12:00:00Z'
REF = 'a' * 20
ENV = {'LINO_BACKUP_MONITOR_ENABLED': 'true', 'LINO_BACKUP_MONITOR_ENABLED_AT': '2026-09-17T00:00:00Z',
       'LINO_BACKUP_PROJECT_REF': REF, 'R2_ENDPOINT_URL': 'https://' + 'b' * 32 + '.r2.cloudflarestorage.com',
       'R2_BUCKET': 'backup-bucket', 'R2_ACCESS_KEY_ID': 'secret-key', 'R2_SECRET_ACCESS_KEY': 'secret-value', 'GITHUB_TOKEN': 'secret-token'}


def run(rid=123, attempt=1, status='completed', conclusion='success'):
    return {'id': rid, 'run_attempt': attempt, 'repository': {'full_name': c.REPOSITORY},
            'head_branch': 'main', 'path': c.WORKFLOW, 'run_started_at': '2026-09-18T10:00:00Z',
            'updated_at': NOW, 'status': status, 'conclusion': conclusion}


class S3:
    def __init__(self):
        self.obj = {'Key': 'lino-backup/v1/' + REF + '/runs/opaque-backup-id/complete.manifest.age',
                    'Size': 100, 'LastModified': '2026-09-18T10:30:00Z', 'ETag': 'etag'}
        self.pages = [{'IsTruncated': False, 'Contents': [self.obj]}]
        self.head = {'ContentLength': 100, 'LastModified': self.obj['LastModified'], 'ETag': 'etag',
                     'Metadata': {'github-run-id': '123', 'github-run-attempt': '1',
                                  'cipher-sha256': 'a' * 64, 'plain-sha256': 'b' * 64}}
        self.calls = []

    def list_objects_v2(self, **kw):
        self.calls.append(('list', kw))
        return self.pages.pop(0)

    def head_object(self, **kw):
        self.calls.append(('head', kw))
        return self.head


class GH:
    def __init__(self):
        self.runs = [run()]
        self.previous = {}
        self.calls = []
        self.mutate_job = lambda job: None

    def get(self, path):
        self.calls.append(path)
        if '/jobs?' in path:
            parts = path.split('/')
            job = {'id': 1, 'run_id': int(parts[3]), 'run_attempt': int(parts[5]),
                   'status': 'completed', 'completed_at': '2026-09-18T11:00:00Z'}
            self.mutate_job(job)
            return {'total_count': 1, 'jobs': [job]}
        if '/attempts/' in path:
            return self.previous[path]
        page = int(path.rsplit('=', 1)[1])
        return {'total_count': len(self.runs), 'workflow_runs': self.runs[(page - 1) * 100:page * 100]}


class CollectorTests(unittest.TestCase):
    def fixture(self):
        return S3(), GH()

    def result(self, s3, gh, env=None):
        return c.monitor(ENV if env is None else env, s3, gh, NOW)

    def test_warning_real_finish_read_only_and_no_receipt(self):
        s3, gh = self.fixture()
        evidence = c.collect(c.config(ENV), s3, gh, NOW)
        self.assertNotIn('restore_receipt', evidence)
        self.assertEqual(evidence['runs'][0]['finished_at'], '2026-09-18T11:00:00Z')
        self.assertEqual(evidence['runs'][0]['run_id'], '123_1')
        result = c.health.evaluate(evidence)
        self.assertEqual(result['state'], 'warning')
        self.assertEqual(result['reasons'], ['latest_restore_not_tested'])
        self.assertEqual([x[0] for x in s3.calls], ['list', 'head'])
        self.assertNotIn('secret', json.dumps(result))

    def test_disabled_and_absent_never_construct_clients(self):
        self.assertEqual(c.monitor({'LINO_BACKUP_MONITOR_ENABLED': 'false'})['state'], 'disabled')
        self.assertEqual(c.monitor({})['state'], 'unconfigured')
        self.assertEqual(c.monitor({'LINO_BACKUP_MONITOR_ENABLED': 'TRUE'})['state'], 'invalid')

    def test_config_identity_and_no_database_credentials(self):
        self.assertEqual(c.config(ENV)['ref'], REF)
        for key, value in [('R2_ENDPOINT_URL', 'https://evil.example'), ('LINO_BACKUP_PROJECT_REF', 'wrong'),
                           ('LINO_BACKUP_MONITOR_ENABLED_AT', '2027-01-01T00:00:00Z')]:
            env = dict(ENV, **{key: value})
            self.assertEqual(self.result(*self.fixture(), env)['state'], 'invalid')

    def test_r2_pagination_counts_all_bytes(self):
        s3, gh = self.fixture()
        s3.pages[0].update(IsTruncated=True, NextContinuationToken='next')
        other = dict(s3.obj, Key='lino-backup/v1/' + REF + '/photos/partial.age', Size=41)
        s3.pages.append({'IsTruncated': False, 'Contents': [other]})
        evidence = c.collect(c.config(ENV), s3, gh, NOW)
        self.assertEqual(evidence['inventory']['stored_bytes'], 141)
        self.assertEqual(s3.calls[2][1]['ContinuationToken'], 'next')

    def test_github_pagination(self):
        s3, gh = self.fixture()
        gh.runs += [run(rid=i, status='queued', conclusion=None) for i in range(1000, 1100)]
        result = self.result(s3, gh)
        self.assertEqual(result['run_count'], 101)
        self.assertTrue(any(path.endswith('page=2') for path in gh.calls))

    def test_rerun_failed_attempt_not_hidden(self):
        s3, gh = self.fixture()
        gh.runs = [run(attempt=2, conclusion='failure')]
        gh.runs[0]['run_started_at'] = '2026-09-18T10:45:00Z'
        gh.previous['/actions/runs/123/attempts/1'] = run()
        result = self.result(s3, gh)
        self.assertEqual(result['state'], 'critical')
        self.assertIn('latest_attempt_failed', result['reasons'])
        self.assertEqual(result['run_count'], 2)

    def test_statuses_no_marker(self):
        for conclusion, mapped in [('failure', 'failed'), ('cancelled', 'cancelled'), ('timed_out', 'failed'),
                                   ('action_required', 'failed'), ('skipped', 'failed')]:
            s3, gh = self.fixture()
            s3.pages[0]['Contents'] = []
            gh.runs[0]['conclusion'] = conclusion
            result = self.result(s3, gh)
            self.assertIn('latest_attempt_' + mapped, result['reasons'])
        for status in ('queued', 'in_progress', 'waiting', 'pending', 'requested'):
            s3, gh = self.fixture()
            s3.pages[0]['Contents'] = []
            gh.runs[0].update(status=status, conclusion=None)
            self.assertIn('attempt_in_progress', self.result(s3, gh)['reasons'])

    def test_success_missing_marker_is_critical(self):
        s3, gh = self.fixture()
        s3.pages[0]['Contents'] = []
        self.assertIn('success_without_complete_marker', self.result(s3, gh)['reasons'])

    def test_bad_marker_evidence(self):
        for change in ('missing_metadata', 'unknown_run', 'failed_run', 'future', 'changed_etag', 'changed_size', 'duplicate', 'before_start'):
            with self.subTest(change=change):
                s3, gh = self.fixture()
                if change == 'missing_metadata': del s3.head['Metadata']['github-run-id']
                if change == 'unknown_run': s3.head['Metadata']['github-run-id'] = '999'
                if change == 'failed_run': gh.runs[0]['conclusion'] = 'failure'
                if change == 'future': s3.head['LastModified'] = '2027-01-01T00:00:00Z'
                if change == 'changed_etag': s3.head['ETag'] = 'changed'
                if change == 'changed_size': s3.head['ContentLength'] = 99
                if change == 'duplicate': s3.pages[0]['Contents'].append(copy.deepcopy(s3.obj))
                if change == 'before_start': gh.runs[0]['run_started_at'] = '2026-09-18T10:45:00Z'
                self.assertEqual(self.result(s3, gh)['state'], 'invalid')

    def test_pagination_errors_and_bounds_fail_closed(self):
        for change in ('missing_token', 'repeat_token', 'short_github', 'exception', 'bound'):
            with self.subTest(change=change):
                s3, gh = self.fixture()
                if change == 'missing_token': s3.pages[0]['IsTruncated'] = True
                if change == 'repeat_token':
                    s3.pages[0].update(IsTruncated=True, NextContinuationToken='same')
                    s3.pages.append(copy.deepcopy(s3.pages[0]))
                if change == 'short_github': gh.get = lambda path: {'total_count': 2, 'workflow_runs': [run()]}
                if change == 'exception':
                    def fail(path): raise RuntimeError('secret-token')
                    gh.get = fail
                if change == 'bound': gh.runs[0]['run_attempt'] = c.MAX_REQUESTS + 1
                result = self.result(s3, gh)
                self.assertEqual(result['state'], 'invalid')
                self.assertNotIn('secret-token', json.dumps(result))

    def test_wrong_github_identity_or_attempt_and_future_job(self):
        for key, value in [('head_branch', 'dev'), ('path', '.github/workflows/evil.yml'),
                           ('repository', {'full_name': 'other/repo'}), ('status', 'unknown'),
                           ('run_started_at', '2027-01-01T00:00:00Z')]:
            s3, gh = self.fixture()
            gh.runs[0][key] = value
            self.assertEqual(self.result(s3, gh)['state'], 'invalid')
        for patch in ({'run_attempt': 2}, {'completed_at': '2027-01-01T00:00:00Z'}, {'status': 'in_progress'}):
            s3, gh = self.fixture()
            gh.mutate_job = lambda job: job.update(patch)
            self.assertEqual(self.result(s3, gh)['state'], 'invalid')

    def test_duplicate_correlations_and_old_unknown_marker_fail(self):
        s3, gh = self.fixture()
        s3.pages[0]['Contents'].append(dict(s3.obj, Key=s3.obj['Key'].replace('opaque-backup-id', 'different-id')))
        self.assertEqual(self.result(s3, gh)['state'], 'invalid')
        s3, gh = self.fixture()
        s3.obj['LastModified'] = s3.head['LastModified'] = '2026-09-16T10:00:00Z'
        s3.head['Metadata']['github-run-id'] = '999'
        self.assertEqual(self.result(s3, gh)['state'], 'invalid')

    def test_runtime_bound_and_empty_terminal_jobs(self):
        s3, gh = self.fixture()
        with patch.object(c.time, 'monotonic', side_effect=[0, c.MAX_SECONDS + 1]):
            self.assertEqual(self.result(s3, gh)['state'], 'invalid')
        self.assertEqual(s3.calls, [])
        s3, gh = self.fixture()
        original = gh.get
        gh.get = lambda path: {'total_count': 0, 'jobs': []} if '/jobs?' in path else original(path)
        self.assertEqual(self.result(s3, gh)['state'], 'invalid')

    def test_documented_job_response_without_attempt(self):
        s3, gh = self.fixture()
        gh.mutate_job = lambda job: job.pop('run_attempt')
        self.assertEqual(self.result(s3, gh)['state'], 'warning')

    def test_adapter_rejects_nonfixed_paths_before_network(self):
        gh = c.GitHub('secret')
        for path in ('https://evil.example', '/actions/runs/1', '/actions/workflows/other.yml/runs?branch=main&per_page=100&page=1'):
            with self.assertRaises(ValueError): gh.get(path)
        with self.assertRaises(ValueError): c.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.example')


if __name__ == '__main__':
    unittest.main()
