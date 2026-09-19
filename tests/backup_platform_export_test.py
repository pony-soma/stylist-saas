import importlib.util
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('platform_export', Path(__file__).resolve().parents[1] / 'scripts/backup/platform_export.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
REF = 'a' * 20
ENV = {'PATH': os.environ.get('PATH', ''), 'LINO_BACKUP_ENABLED': 'true',
       'LINO_BACKUP_PROJECT_REF': REF, 'SUPABASE_URL': 'https://' + REF + '.supabase.co',
       'PGHOST': 'db.' + REF + '.supabase.co', 'PGUSER': 'postgres',
       'PGDATABASE': 'postgres', 'PGPASSWORD': 'dummy-secret', 'PGSSLMODE': 'require'}
LOCAL = dict(ENV, CI='true', LINO_E2E_LOCAL='1', PGHOST='127.0.0.1', PGPORT='54322',
             NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321', PGSSLMODE='disable')


class PlatformExportTests(unittest.TestCase):
    def test_only_exact_project_or_fixed_local_ci_and_no_password_in_url(self):
        child, url = p.connection_environment(ENV)
        self.assertNotIn(ENV['PGPASSWORD'], url)
        self.assertEqual(child['PGPASSWORD'], ENV['PGPASSWORD'])
        self.assertEqual(child['PGOPTIONS'], '-c default_transaction_read_only=on')
        self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY', child)
        p.connection_environment(LOCAL)
        p.connection_environment(dict(ENV, PGHOST='aws-0-ap-northeast-1.pooler.supabase.com', PGUSER='postgres.' + REF))
        for updates in [{'PGHOST': 'evil.test'}, {'PGPORT': '6543'}, {'PGUSER': 'supabase_admin'},
                        {'PGSSLMODE': 'disable'}, {'LINO_BACKUP_ENABLED': 'false'}, {'PGPASSWORD': ''},
                        {'SUPABASE_URL': 'https://other.supabase.co'}, {'PGDATABASE': 'other'}]:
            with self.subTest(updates=updates), self.assertRaises(p.PlatformExportError):
                p.connection_environment(dict(ENV, **updates))
        for updates in [{'CI': 'false'}, {'LINO_E2E_LOCAL': '0'}, {'PGPORT': '54332'},
                        {'PGHOST': 'localhost'}, {'NEXT_PUBLIC_SUPABASE_URL': 'https://example.test'}]:
            with self.subTest(updates=updates), self.assertRaises(p.PlatformExportError):
                p.connection_environment(dict(LOCAL, **updates))

    def fake_runner(self, history=True, fail=None, role='postgres', superuser=False, hooks=False, sequence=None, empty=True, initial=True, dependencies=False):
        self.calls = []
        def run(command, env, limit, capture=False):
            self.calls.append(command)
            self.assertNotIn(ENV['PGPASSWORD'], ' '.join(command))
            if '--version' in command:
                return (p.CLI_VERSION + '\n').encode()
            if command[0] == 'psql':
                self.assertIn('-X', command)
                self.assertIn('ON_ERROR_STOP=1', command)
                if "'hooks_guard'" in command[-1]:
                    return json.dumps({'hooks_guard': True, 'empty': empty, 'initial': initial}).encode()
                return json.dumps({'role': role, 'superuser': superuser, 'history': history, 'hooks_table': hooks, 'hooks_sequence': hooks if sequence is None else sequence, 'webhook_dependencies': dependencies}).encode()
            file = Path(command[command.index('--file') + 1])
            file.write_bytes(b'-- SQL fixture\n')
            if file.name == fail:
                raise RuntimeError('raw password dump diagnostic must not escape')
        return run

    def test_package_members_hashes_and_unresolved_gates(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(p, '_run', self.fake_runner()):
            target = Path(folder) / 'database.tar'
            report = p.export_platform(target, 1024*1024, ENV)
            self.assertEqual(report['database_format'], p.FORMAT)
            self.assertEqual(report['data_mode'], 'copy')
            self.assertFalse(report['hosted_restore_verified'])
            self.assertEqual(report['migration_history'], 'included')
            self.assertEqual(len(report['restore_gates']), 5)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            with tarfile.open(target) as archive:
                self.assertEqual(set(archive.getnames()), {'roles.sql','pre_restore.sql','schema.sql','data.sql','history_schema.sql','history_data.sql','package.json'})
                self.assertEqual(json.load(archive.extractfile('package.json')), report)
                self.assertEqual(archive.extractfile('pre_restore.sql').read().decode(), p.PRE_RESTORE_SQL)
                self.assertEqual(report['restore_order'], ['roles.sql','pre_restore.sql','schema.sql','history_schema.sql','data.sql','history_data.sql'])
                for name, meta in report['files'].items():
                    data = archive.extractfile(name).read()
                    self.assertEqual(meta['bytes'], len(data))
                    self.assertEqual(meta['sha256'], p.hashlib.sha256(data).hexdigest())
            self.assertEqual([item.name for item in Path(folder).iterdir()], ['database.tar'])
            dumps = [cmd for cmd in self.calls if 'dump' in cmd]
            self.assertEqual(len(dumps), 5)
            self.assertIn('--role-only', dumps[0])
            self.assertIn('--data-only', dumps[2])
            self.assertIn('--use-copy', dumps[2])
            self.assertIn('storage.vector_indexes', dumps[2])
            self.assertFalse(any('pg_dump' in cmd or 'pg_restore' in cmd for cmd in self.calls))

    def test_inserts_omit_copy_flag_and_invalid_mode_fails_before_io(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(p, '_run', self.fake_runner()):
            target = Path(folder) / 'database.tar'
            report = p.export_platform(target, 1024*1024, LOCAL, data_mode='inserts')
            self.assertEqual(report['data_mode'], 'inserts')
            dumps = [cmd for cmd in self.calls if 'dump' in cmd and '--data-only' in cmd]
            self.assertEqual(len(dumps), 2)
            self.assertTrue(all('--use-copy' not in cmd for cmd in dumps))
        with patch.object(p, '_run') as runner, self.assertRaises(p.PlatformExportError):
            p.export_platform(Path('/unused'), 1024, LOCAL, data_mode='unknown')
        runner.assert_not_called()

    def test_only_unused_managed_hook_sequence_is_excluded(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(p, '_run', self.fake_runner(hooks=True)):
            report = p.export_platform(Path(folder) / 'database.tar', 1024*1024, LOCAL)
            self.assertEqual(report['managed_webhook_state'], 'empty-unused; initial managed sequence omitted')
            dumps = [cmd for cmd in self.calls if 'dump' in cmd and '--data-only' in cmd]
            self.assertIn('supabase_functions.hooks_id_seq', dumps[0])
            self.assertNotIn('supabase_functions.hooks', dumps[0])
        for args in [{'hooks': True, 'empty': False}, {'hooks': True, 'initial': False},
                     {'hooks': True, 'dependencies': True}, {'hooks': True, 'sequence': False},
                     {'hooks': False, 'sequence': True}, {'dependencies': True}]:
            with self.subTest(args=args), tempfile.TemporaryDirectory() as folder, patch.object(p, '_run', self.fake_runner(**args)):
                with self.assertRaises(p.PlatformExportError):
                    p.export_platform(Path(folder) / 'database.tar', 1024*1024, LOCAL)
                self.assertFalse(any('dump' in cmd for cmd in self.calls))
                self.assertEqual(list(Path(folder).iterdir()), [])

    def test_absent_history_is_explicit_not_silently_failed(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(p, '_run', self.fake_runner(history=False)):
            report = p.export_platform(Path(folder) / 'database.tar', 1024*1024, ENV)
            self.assertEqual(report['migration_history'], 'absent')
            self.assertNotIn('history_data.sql', report['files'])
            self.assertEqual(report['restore_order'], ['roles.sql','pre_restore.sql','schema.sql','data.sql'])

    def test_failed_export_removes_plaintext_and_redacts_exception(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(p, '_run', self.fake_runner(fail='data.sql')):
            with self.assertRaises(p.PlatformExportError) as caught:
                p.export_platform(Path(folder) / 'database.tar', 1024*1024, ENV)
            self.assertNotIn('password', str(caught.exception))
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_rejects_admin_or_superuser_before_dump(self):
        for role, superuser in [('supabase_admin', True), ('postgres', True)]:
            with tempfile.TemporaryDirectory() as folder, patch.object(p, '_run', self.fake_runner(role=role, superuser=superuser)):
                with self.assertRaises(p.PlatformExportError):
                    p.export_platform(Path(folder) / 'database.tar', 1024*1024, ENV)
                self.assertFalse(any('dump' in cmd for cmd in self.calls))

    def test_size_gate_and_private_directory_and_existing_output(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(p, '_run', self.fake_runner()):
            target = Path(folder) / 'database.tar'
            with self.assertRaises(p.PlatformExportError):
                p.export_platform(target, 100, ENV)
            self.assertFalse(target.exists())
            Path(folder).chmod(0o755)
            with self.assertRaises(p.PlatformExportError):
                p.export_platform(target, 1024*1024, ENV)
            Path(folder).chmod(0o700)
            target.write_bytes(b'existing')
            with self.assertRaises(p.PlatformExportError):
                p.export_platform(target, 1024*1024, ENV)
            self.assertEqual(target.read_bytes(), b'existing')

    def test_diagnostics_are_fixed_codes_not_raw_subprocess_data(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(p, '_run', self.fake_runner(dependencies=True)):
            with self.assertRaises(p.PlatformExportError) as caught:
                p.export_platform(Path(folder) / 'database.tar', 1024*1024, LOCAL)
            self.assertEqual(caught.exception.code, 'WEBHOOK_DEPENDENCY')
        with patch.object(p.sys, 'argv', ['platform_export.py', '/unused']), patch.object(p, 'export_platform', side_effect=p.PlatformExportError('password private row', 'INVENTORY_READ_FAILED')), patch('sys.stderr') as stderr:
            self.assertEqual(p.main(), 1)
            printed = ''.join(str(call.args) for call in stderr.write.call_args_list)
            self.assertIn('PLATFORM_EXPORT_CODE=INVENTORY_READ_FAILED', printed)
            self.assertNotIn('password', printed)
            self.assertNotIn('private row', printed)
        self.assertEqual(p.PlatformExportError('secret', 'private-value').code, 'PRECONDITION_FAILED')

    def test_version_pin_and_subprocess_redaction(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(p, '_run', return_value=b'2.0.0\n'):
            with self.assertRaises(p.PlatformExportError):
                p.export_platform(Path(folder) / 'database.tar', 1024*1024, ENV)
        with patch.object(p.subprocess, 'run', side_effect=RuntimeError('private row password')):
            with self.assertRaises(p.PlatformExportError) as caught:
                p._run(['false'], {}, 1000)
            self.assertEqual(str(caught.exception), 'platform export subprocess failed')


if __name__ == '__main__':
    unittest.main()
