import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/backup/health.py'
SPEC = importlib.util.spec_from_file_location('backup_health', SCRIPT)
health = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(health)


def fixture():
    return {
        'evaluated_at': '2026-09-18T12:00:00Z',
        'expectation_enabled': True,
        'enabled_at': '2026-09-15T00:00:00Z',
        'inventory': {'observed_at': '2026-09-18T12:00:00Z', 'complete': True,
                      'stored_bytes': 100, 'markers': [
                          {'run_id': 'run-one', 'completed_at': '2026-09-18T10:00:00Z'}]},
        'runs': [{'run_id': 'run-one', 'started_at': '2026-09-18T09:00:00Z',
                  'status': 'success', 'finished_at': '2026-09-18T10:00:00Z'}],
        'restore_receipt': {'run_id': 'run-one', 'tested_at': '2026-09-18T11:00:00Z', 'result': 'passed'},
    }


class HealthTests(unittest.TestCase):
    def test_valid_evidence_is_deterministic_and_redacted(self):
        d = fixture()
        before = copy.deepcopy(d)
        result = health.evaluate(d)
        self.assertEqual(result['state'], 'healthy')
        self.assertEqual(result, health.evaluate(d))
        self.assertEqual(d, before)
        self.assertNotIn('run-one', json.dumps(result))

    def test_disabled_and_unconfigured_never_healthy(self):
        d = fixture()
        d['expectation_enabled'] = False
        self.assertEqual(health.evaluate(d)['state'], 'disabled')
        del d['expectation_enabled']
        self.assertEqual(health.evaluate(d)['state'], 'unconfigured')
        d = fixture()
        del d['enabled_at']
        self.assertEqual(health.evaluate(d)['state'], 'unconfigured')

    def test_never_run_and_missed_daily_attempt(self):
        d = fixture()
        d['runs'] = []
        d['inventory']['markers'] = []
        d.pop('restore_receipt')
        result = health.evaluate(d)
        self.assertEqual(result['state'], 'critical')
        self.assertIn('never_run', result['reasons'])
        self.assertIn('daily_attempt_overdue', result['reasons'])

    def test_stale_or_incomplete_inventory_blocks_healthy(self):
        for mutation, reason in [('stale', 'inventory_stale'), ('incomplete', 'inventory_incomplete')]:
            d = fixture()
            if mutation == 'stale':
                d['evaluated_at'] = '2026-09-18T13:00:01Z'
            else:
                d['inventory']['complete'] = False
            self.assertIn(reason, health.evaluate(d)['reasons'])
            self.assertEqual(health.evaluate(d)['state'], 'critical')

    def test_new_failure_and_cancel_override_recent_success(self):
        for status in ('failed', 'cancelled'):
            d = fixture()
            d['runs'].append({'run_id': 'run-two', 'started_at': '2026-09-18T11:00:00Z',
                              'status': status, 'finished_at': '2026-09-18T11:30:00Z'})
            result = health.evaluate(d)
            self.assertEqual(result['state'], 'critical')
            self.assertIn('latest_attempt_' + status, result['reasons'])

    def test_running_and_overdue(self):
        for started, expected in [('2026-09-18T11:00:00Z', 'warning'), ('2026-09-18T09:00:00Z', 'critical')]:
            d = fixture()
            d['runs'].append({'run_id': 'run-two', 'started_at': started, 'status': 'in_progress'})
            self.assertEqual(health.evaluate(d)['state'], expected)

    def test_completion_age_threshold_and_missed_run(self):
        d = fixture()
        d['evaluated_at'] = '2026-09-19T22:00:00Z'
        d['inventory']['observed_at'] = d['evaluated_at']
        result = health.evaluate(d)
        self.assertEqual(result['state'], 'warning')
        self.assertIn('daily_attempt_overdue', result['reasons'])
        self.assertNotIn('completion_stale', result['reasons'])
        d['evaluated_at'] = '2026-09-19T22:00:01Z'
        self.assertIn('completion_stale', health.evaluate(d)['reasons'])

    def test_completion_is_not_restore_evidence(self):
        d = fixture()
        del d['restore_receipt']
        result = health.evaluate(d)
        self.assertEqual(result['state'], 'warning')
        self.assertEqual(result['restore_evidence'], 'not_tested')

    def test_forged_receipts_and_future_timestamps_fail_closed(self):
        for field in ('evaluated_future_inventory', 'future_receipt', 'unknown_receipt_run', 'early_receipt', 'wrong_zone'):
            d = fixture()
            if field == 'evaluated_future_inventory':
                d['inventory']['observed_at'] = '2026-09-18T12:00:01Z'
            elif field == 'future_receipt':
                d['restore_receipt']['tested_at'] = '2099-01-01T00:00:00Z'
            elif field == 'unknown_receipt_run':
                d['restore_receipt']['run_id'] = 'other'
            elif field == 'early_receipt':
                d['restore_receipt']['tested_at'] = '2026-09-18T09:00:00Z'
            else:
                d['inventory']['observed_at'] = '2026-09-18T12:00:00+00:00'
            self.assertEqual(health.evaluate(d)['state'], 'invalid', field)

    def test_success_needs_marker_and_marker_needs_success(self):
        d = fixture()
        d['inventory']['markers'] = []
        del d['restore_receipt']
        self.assertIn('success_without_complete_marker', health.evaluate(d)['reasons'])
        d = fixture()
        d['runs'][0]['status'] = 'failed'
        self.assertEqual(health.evaluate(d)['state'], 'invalid')

    def test_capacity_boundary(self):
        d = fixture()
        d['inventory']['stored_bytes'] = (health.CAP_BYTES * 4 + 4) // 5
        self.assertIn('capacity_warning', health.evaluate(d)['reasons'])
        d['inventory']['stored_bytes'] = health.CAP_BYTES
        self.assertIn('capacity_limit_reached', health.evaluate(d)['reasons'])

    def test_old_restore_receipt_cannot_cover_new_backup(self):
        d = fixture()
        d['runs'].append({'run_id': 'run-two', 'started_at': '2026-09-18T11:00:00Z',
                          'status': 'success', 'finished_at': '2026-09-18T11:30:00Z'})
        d['inventory']['markers'].append({'run_id': 'run-two', 'completed_at': '2026-09-18T11:30:00Z'})
        result = health.evaluate(d)
        self.assertEqual(result['state'], 'warning')
        self.assertEqual(result['restore_evidence'], 'receipt_for_older_run')

    def test_duplicate_ids_boolean_sizes_and_unknown_fields_invalid(self):
        for mutation in ('duplicate', 'boolean', 'unknown'):
            d = fixture()
            if mutation == 'duplicate':
                d['runs'].append(copy.deepcopy(d['runs'][0]))
            elif mutation == 'boolean':
                d['inventory']['stored_bytes'] = True
            else:
                d['credential'] = 'sensitive'
            self.assertEqual(health.evaluate(d), {'state': 'invalid', 'reasons': ['invalid_input']})

    def test_cli_redacts_errors_rejects_duplicate_keys_and_returns_codes(self):
        for payload, code in [(json.dumps(fixture()), 0), ('{"expectation_enabled":false,"expectation_enabled":true}', 2), ('private-secret-invalid-json', 2)]:
            result = subprocess.run([sys.executable, str(SCRIPT)], input=payload, text=True, capture_output=True)
            self.assertEqual(result.returncode, code)
            self.assertEqual(result.stderr, '')
            self.assertNotIn('private-secret', result.stdout)
            json.loads(result.stdout)


if __name__ == '__main__':
    unittest.main()
