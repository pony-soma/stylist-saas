import io
import unittest
from unittest.mock import patch
from backup_test import b, ENV, S3, Storage, fake_dump, fake_encrypt

class StagedTests(unittest.TestCase):
    @patch.object(b, 'dump_database', fake_dump)
    @patch.object(b, 'encrypt', fake_encrypt)
    def test_staged_worker_never_publishes_completion(self):
        s3 = S3()
        with patch('sys.stdout', new_callable=io.StringIO) as output:
            b.run(b.config(ENV), s3, Storage(), staged=True, checkpoint=lambda: None)
        self.assertTrue(s3.uploads[-1].endswith('/pending.manifest.age'))
        self.assertFalse(any('/complete.manifest.age' in key for key in s3.objects))
        self.assertIn('"status": "staged"', output.getvalue())

    def test_staged_requires_cancellation_checkpoint(self):
        with self.assertRaises(b.BackupError):
            b.run(b.config(ENV), S3(), Storage(), staged=True)

    @patch.object(b, 'dump_database', fake_dump)
    @patch.object(b, 'encrypt', fake_encrypt)
    def test_every_checkpoint_can_cancel_without_a_completion(self):
        seen = []
        with patch('sys.stdout', new_callable=io.StringIO):
            b.run(b.config(ENV), S3(), Storage(), staged=True, checkpoint=lambda: seen.append(1))
        for stop_at in range(1, len(seen) + 1):
            calls = 0
            def checkpoint():
                nonlocal calls
                calls += 1
                b.require(calls != stop_at)
            s3 = S3()
            with self.subTest(stop_at=stop_at), patch('sys.stdout', new_callable=io.StringIO) as output:
                with self.assertRaises(b.BackupError):
                    b.run(b.config(ENV), s3, Storage(), staged=True, checkpoint=checkpoint)
                self.assertFalse(any('/complete.manifest.age' in key for key in s3.objects))
                self.assertEqual(output.getvalue(), '')

    @patch.object(b, 'encrypt', fake_encrypt)
    def test_cancel_after_dump_removes_temporary_plaintext(self):
        paths = []
        def dump(target, limit):
            paths.append(target)
            return fake_dump(target, limit)
        def checkpoint():
            b.require(not paths)
        with patch.object(b, 'dump_database', dump), self.assertRaises(b.BackupError):
            b.run(b.config(ENV), S3(), Storage(), staged=True, checkpoint=checkpoint)
        self.assertEqual(len(paths), 1)
        self.assertFalse(paths[0].exists())
        self.assertFalse(paths[0].parent.exists())

if __name__ == '__main__': unittest.main()
