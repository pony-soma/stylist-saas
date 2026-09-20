"""Real age CLI check with a throwaway key; no Supabase/R2 credentials."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup_encrypt_subject', Path(__file__).parents[1] / 'scripts/backup/backup.py')
subject = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = subject
spec.loader.exec_module(subject)

class EncryptionRoundtrip(unittest.TestCase):
    def test_roundtrip_and_wrong_key(self):
        if not shutil.which('age') or not shutil.which('age-keygen'):
            if os.environ.get('CI') == 'true':
                self.fail('CI must install age for real encryption verification')
            self.skipTest('age not installed locally; required in CI')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            identity = root / 'identity.txt'
            subprocess.run(['age-keygen', '-o', str(identity)], check=True, capture_output=True)
            recipient = subprocess.run(['age-keygen', '-y', str(identity)], check=True, capture_output=True, text=True).stdout.strip()
            plain, encrypted, restored = root/'plain', root/'encrypted', root/'restored'
            payload = ('LiNo dummy only: 復元テスト\n' * 20).encode()
            plain.write_bytes(payload)
            subject.encrypt(plain, encrypted, recipient)
            self.assertFalse(plain.exists())
            self.assertNotIn(payload, encrypted.read_bytes())
            subprocess.run(['age', '-d', '-i', str(identity), '-o', str(restored), str(encrypted)], check=True, capture_output=True)
            self.assertEqual(restored.read_bytes(), payload)
            wrong = root/'wrong.txt'
            subprocess.run(['age-keygen','-o',str(wrong)],check=True,capture_output=True)
            attempt = subprocess.run(['age','-d','-i',str(wrong),str(encrypted)],capture_output=True)
            self.assertNotEqual(attempt.returncode, 0)
            self.assertEqual(attempt.stdout, b'')

if __name__ == '__main__': unittest.main()
