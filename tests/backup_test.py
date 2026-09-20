import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('backup', Path(__file__).resolve().parents[1] / 'scripts/backup/backup.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
REF = 'a' * 20
ENV = {'LINO_BACKUP_DATABASE_FORMAT':'pg-custom-v1', 'LINO_BACKUP_ENABLED': 'true', 'LINO_BACKUP_PROJECT_REF': REF, 'SUPABASE_URL': 'https://' + REF + '.supabase.co', 'PGHOST': 'db.' + REF + '.supabase.co', 'PGUSER': 'postgres', 'PGDATABASE': 'postgres', 'PGPASSWORD': 'dummy', 'PGSSLMODE': 'require', 'SUPABASE_SERVICE_ROLE_KEY': 'dummy', 'R2_ENDPOINT_URL': 'https://' + 'a' * 32 + '.r2.cloudflarestorage.com', 'R2_BUCKET': 'test-private', 'R2_ACCESS_KEY_ID': 'dummy', 'R2_SECRET_ACCESS_KEY': 'dummy', 'AGE_RECIPIENT': 'age1' + 'a' * 58}
class Missing(Exception):
    response = {'Error': {'Code': '404'}}
class S3:
    def __init__(self): self.objects, self.uploads, self.fail = {}, [], False
    def get_paginator(self, name): return self
    def paginate(self, **kw): return [{'Contents': [{'Size': len(v['bytes'])} for k,v in self.objects.items() if k.startswith(kw['Prefix'])]}]
    def head_object(self, Bucket, Key):
        if Key not in self.objects: raise Missing()
        obj = self.objects[Key]
        return {'ContentLength': len(obj['bytes']), 'Metadata': obj['metadata']}
    def upload_file(self, source, bucket, key, ExtraArgs):
        if self.fail: raise RuntimeError('secret')
        data = Path(source).read_bytes()
        assert data.startswith(b'age-encryption.org/v1\n')
        self.objects[key] = {'bytes': data, 'metadata': ExtraArgs['Metadata']}
        self.uploads.append(key)
class Storage:
    def __init__(self): self.calls, self.downloads, self.change = 0, 0, False
    def listing(self):
        self.calls += 1
        return [{'path': 'private/photo.jpg', 'id': 'fake', 'created_at': '2026', 'updated_at': 'changed' if self.change and self.calls > 1 else '2026', 'metadata': {'size': 5}}]
    def download(self, entry, target, remaining):
        b.require(remaining >= 5)
        self.downloads += 1
        target.write_bytes(b'photo')
        return 5

def fake_dump(target, limit):
    b.require(limit >= 4)
    target.write_bytes(b'dump')
    return 4

def fake_encrypt(source, destination, recipient):
    destination.write_bytes(b'age-encryption.org/v1\n' + source.read_bytes())
    source.unlink()

class BackupTests(unittest.TestCase):
    def test_provenance_refuses_partial_or_unsafe_ids(self):
        self.assertEqual(b.github_provenance({}), {})
        self.assertEqual(b.github_provenance({'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'2'}), {'github-run-id':'123','github-run-attempt':'2'})
        for value in ('0','-1','text','123\n',None):
            with self.subTest(value=value), self.assertRaises(b.BackupError):
                b.github_provenance({'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':value})
        with self.assertRaises(b.BackupError): b.github_provenance({'GITHUB_RUN_ID':'123'})

    @patch.object(b, 'dump_database', fake_dump)
    @patch.object(b, 'encrypt', fake_encrypt)
    def test_completion_is_correlated_but_photos_are_not(self):
        s3=S3()
        with patch.dict(os.environ, {'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'2'}), patch('sys.stdout', new_callable=io.StringIO):
            b.run(b.config(ENV),s3,Storage())
        for key,obj in s3.objects.items():
            if key.endswith('/complete.manifest.age'):
                self.assertEqual(obj['metadata']['github-run-id'],'123')
                self.assertEqual(obj['metadata']['github-run-attempt'],'2')
            else:
                self.assertNotIn('github-run-id', obj['metadata'])

    @patch.object(b, 'dump_platform_database', fake_dump)
    @patch.object(b, 'encrypt', fake_encrypt)
    def test_platform_package_has_explicit_manifest_format(self):
        import json
        s3=S3()
        cfg=b.config(dict(ENV,LINO_BACKUP_DATABASE_FORMAT='supabase-cli-platform-v1'))
        with patch('sys.stdout', new_callable=io.StringIO): b.run(cfg,s3,Storage())
        raw=next(v['bytes'] for k,v in s3.objects.items() if k.endswith('/complete.manifest.age'))
        manifest=json.loads(raw.split(b'\n',1)[1])
        self.assertEqual(manifest['format'],2)
        self.assertEqual(manifest['database_format'],'supabase-cli-platform-v1')
        self.assertFalse(manifest['atomic_snapshot'])

    def test_config(self):
        b.config(ENV)
        for key,value in [('LINO_BACKUP_ENABLED','false'),('PGHOST','evil.test'),('PGUSER','postgres.wrong'),('PGPORT','6543'),('PGSSLMODE','disable'),('SUPABASE_URL','https://evil.test'),('R2_ENDPOINT_URL','https://evil.test'),('AGE_RECIPIENT',''),('LINO_BACKUP_MAX_BYTES','0')]:
            with self.subTest(key=key), self.assertRaises(b.BackupError): b.config(dict(ENV, **{key:value}))
        b.config(dict(ENV, PGHOST='aws-0-ap-northeast-1.pooler.supabase.com', PGUSER='postgres.' + REF))
    @patch.object(b, 'dump_database', fake_dump)
    @patch.object(b, 'encrypt', fake_encrypt)
    def test_success_dedup(self):
        s3,storage = S3(),Storage()
        with patch('sys.stdout', new_callable=io.StringIO):
            b.run(b.config(ENV),s3,storage)
            self.assertTrue(s3.uploads[-1].endswith('/complete.manifest.age'))
            b.run(b.config(ENV),s3,storage)
        self.assertEqual(storage.downloads,2)
        self.assertTrue(all('private' not in k for k in s3.objects))
    @patch.object(b, 'dump_database', fake_dump)
    @patch.object(b, 'encrypt', fake_encrypt)
    def test_same_metadata_changed_bytes_refuses_reuse(self):
        s3, storage = S3(), Storage()
        with patch('sys.stdout', new_callable=io.StringIO): b.run(b.config(ENV), s3, storage)
        saved = {k: v['bytes'] for k, v in s3.objects.items() if '/photos/' in k}
        markers = [k for k in s3.objects if 'complete.manifest' in k]
        def changed(entry, target, remaining):
            b.require(remaining >= 5)
            target.write_bytes(b'other')
            return 5
        storage.download = changed
        with self.assertRaises(b.BackupError): b.run(b.config(ENV), s3, storage)
        self.assertEqual(markers, [k for k in s3.objects if 'complete.manifest' in k])
        self.assertEqual(saved, {k: v['bytes'] for k, v in s3.objects.items() if '/photos/' in k})
    @patch.object(b, 'dump_database', fake_dump)
    @patch.object(b, 'encrypt', fake_encrypt)
    def test_reused_photos_still_count_toward_download_budget(self):
        s3, storage = S3(), Storage()
        with patch('sys.stdout', new_callable=io.StringIO): b.run(b.config(ENV), s3, storage)
        markers = [k for k in s3.objects if 'complete.manifest' in k]
        cfg = b.config(ENV)
        cfg['limit'] = 8  # DB=4 + photo=5, even if ciphertext is already stored.
        with self.assertRaises(b.BackupError): b.run(cfg, s3, storage)
        self.assertEqual(markers, [k for k in s3.objects if 'complete.manifest' in k])
    @patch.object(b, 'dump_database', fake_dump)
    @patch.object(b, 'encrypt', fake_encrypt)
    def test_changed_listing(self):
        s3,storage = S3(),Storage()
        storage.change = True
        with self.assertRaises(b.BackupError): b.run(b.config(ENV),s3,storage)
        self.assertFalse(any('complete.manifest' in k for k in s3.objects))
    @patch.object(b, 'dump_database', fake_dump)
    @patch.object(b, 'encrypt', fake_encrypt)
    def test_upload_failure_and_budget(self):
        for fail,limit in [(True,10000),(False,1)]:
            s3 = S3(); s3.fail = fail
            cfg = b.config(ENV); cfg['stored_limit'] = limit
            with self.assertRaises(Exception): b.run(cfg,s3,Storage())
            self.assertFalse(any('complete.manifest' in k for k in s3.objects))
    @patch.object(b, 'dump_database', fake_dump)
    def test_encrypt_failure(self):
        s3 = S3()
        with patch.object(b,'encrypt',side_effect=RuntimeError('failed')), self.assertRaises(RuntimeError): b.run(b.config(ENV),s3,Storage())
        self.assertEqual(s3.uploads,[])
    def test_ciphertext_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            source,destination = Path(tmp)/'plain',Path(tmp)/'encrypted'
            source.write_bytes(b'sensitive')
            def invalid(*args,**kw): destination.write_bytes(b'not encrypted')
            with patch.object(b.subprocess,'run',side_effect=invalid),self.assertRaises(b.BackupError): b.encrypt(source,destination,ENV['AGE_RECIPIENT'])
            self.assertTrue(source.exists())
    def test_pg_environment_cannot_override_target(self):
        from unittest.mock import MagicMock
        proc = MagicMock()
        proc.stdout = io.BytesIO(b'dump')
        proc.wait.return_value = 0
        proc.poll.return_value = 0
        env = dict(ENV, PGHOSTADDR='127.0.0.1', PGSERVICE='evil', PGPASSFILE='/evil', PGOPTIONS='evil')
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, env, clear=True), patch.object(b.subprocess, 'Popen', return_value=proc) as call:
            b.dump_database(Path(tmp) / 'archive', 100)
        actual = call.call_args.kwargs['env']
        for name in ('PGHOSTADDR', 'PGSERVICE', 'PGPASSFILE', 'R2_SECRET_ACCESS_KEY'):
            self.assertNotIn(name, actual)
        self.assertEqual(actual['PGHOST'], ENV['PGHOST'])
        self.assertNotEqual(actual['PGOPTIONS'], 'evil')
        self.assertIn('--lock-wait-timeout=60s', call.call_args.args[0])
    def test_sanitized_log(self):
        with patch.dict(os.environ,{},clear=True),patch('sys.stderr',new_callable=io.StringIO) as output: self.assertEqual(b.main(),1)
        self.assertNotIn('dummy',output.getvalue())
if __name__ == '__main__': unittest.main()
