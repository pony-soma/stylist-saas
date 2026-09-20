import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/backup/reconcile_photos.py'
spec = importlib.util.spec_from_file_location('photo_reconciliation', SCRIPT)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
REF = 'a' * 20


class PhotoReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.key = 'lino-backup/v1/' + REF + '/photos/' + 'b' * 64 + '.age'
        self.local = self.root / (hashlib.sha256(self.key.encode()).hexdigest() + '.plain')
        self.local.write_bytes(b'photo')
        self.manifest = {'format': 2, 'database_format': 'supabase-cli-platform-v1',
            'project_ref': REF, 'atomic_snapshot': False, 'photos': [{
                'source': {'path': 'private/photo.png', 'metadata': {'size': 5}},
                'object': {'key': self.key, 'plain_sha256': hashlib.sha256(b'photo').hexdigest()}}]}

    def check(self, refs=None):
        return r.reconcile(self.manifest, ['private/photo.png'] if refs is None else refs, self.root, REF)

    def test_valid_and_unreferenced_preserved(self):
        result = self.check()
        self.assertEqual(result['verified_objects'], 1)
        self.assertFalse(result['source_quiescence_verified'])
        self.assertFalse(result['atomic_snapshot'])
        self.assertEqual(self.check([])['unreferenced_objects'], 1)
        self.assertTrue(self.local.exists())

    def test_missing_reference_and_duplicate_reference(self):
        for refs in [['missing.png'], ['private/photo.png'] * 2, ['../private/photo.png'], ['']]:
            with self.subTest(refs=refs), self.assertRaises(r.Refused): self.check(refs)

    def test_missing_corrupt_same_size_and_truncated_photo(self):
        for data in [b'other', b'phot', b'photos']:
            self.local.write_bytes(data)
            with self.subTest(data=data), self.assertRaises(r.Refused): self.check()
        self.local.unlink()
        with self.assertRaises(r.Refused): self.check()

    def test_symlink_rejected(self):
        original = self.root / 'original'
        self.local.rename(original)
        self.local.symlink_to(original)
        with self.assertRaises(r.Refused): self.check()

    def test_foreign_project_duplicate_and_bad_manifest(self):
        original = copy.deepcopy(self.manifest)
        for field, value in [('project_ref', 'c' * 20), ('format', True), ('atomic_snapshot', True), ('database_format', 'unknown')]:
            self.manifest = dict(original, **{field: value})
            with self.subTest(field=field), self.assertRaises(r.Refused): self.check()
        self.manifest = copy.deepcopy(original)
        self.manifest['photos'] *= 2
        with self.assertRaises(r.Refused): self.check()
        self.manifest = copy.deepcopy(original)
        self.manifest['photos'][0]['object']['key'] = '../escape.age'
        with self.assertRaises(r.Refused): self.check()

    def test_budget_and_boolean_size_rejected(self):
        for size in [True, -1, r.MAX_BYTES + 1]:
            self.manifest['photos'][0]['source']['metadata']['size'] = size
            with self.subTest(size=size), self.assertRaises(r.Refused): self.check()

    def test_cli_failure_never_prints_private_paths(self):
        manifest, refs = self.root / 'manifest.json', self.root / 'refs.json'
        manifest.write_text(json.dumps(self.manifest))
        refs.write_text(json.dumps(['PRIVATE_CUSTOMER_IDENTIFIER']))
        result = subprocess.run([sys.executable, str(SCRIPT), '--manifest', str(manifest),
            '--references', str(refs), '--objects', str(self.root), '--project-ref', REF], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout), {'status':'failed','code':'PHOTO_RECONCILIATION_FAILED'})
        self.assertEqual(result.stderr, '')

    def test_duplicate_json_keys_rejected(self):
        f = self.root / 'duplicate.json'
        f.write_text('{"photos":[],"photos":[]}')
        with self.assertRaises(r.Refused): r.read_json(f)


if __name__ == '__main__': unittest.main()
