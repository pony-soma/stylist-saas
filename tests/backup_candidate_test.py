import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('candidate', Path(__file__).resolve().parents[1] / 'scripts/backup/candidate_capture.py')
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class CandidateApproval(unittest.TestCase):
    def setUp(self):
        sha = 'a' * 40
        ref = 'refs/tags/lino-candidate-20260920T010000Z-' + sha[:12]
        self.now = dt.datetime(2026, 9, 20, 1, 10, tzinfo=dt.timezone.utc)
        self.env = dict(GITHUB_SHA=sha, GITHUB_REF=ref,
            GITHUB_REPOSITORY='pony-soma/stylist-saas', GITHUB_EVENT_NAME='push',
            GITHUB_REF_TYPE='tag', GITHUB_RUN_ATTEMPT='1',
            LINO_CANDIDATE_CAPTURE_ENABLED='true',
            LINO_CANDIDATE_ACK='candidate-only-not-cutover-recovery',
            LINO_CANDIDATE_APPROVED_SHA=sha, LINO_CANDIDATE_APPROVED_REF=ref,
            LINO_BACKUP_PROJECT_REF='pprlqowossudjvtgkfir',
            LINO_CANDIDATE_EXPIRES_UTC='2026-09-20T01:50:00Z')
        self.event = dict(ref=ref, after=sha, created=True, deleted=False, forced=False)

    def test_exact_approval_passes(self):
        candidate.authorize(self.env, self.event, self.now)

    def test_missing_approval_and_context_fail(self):
        for key in self.env:
            with self.subTest(key=key):
                changed = dict(self.env)
                del changed[key]
                with self.assertRaises(ValueError):
                    candidate.authorize(changed, self.event, self.now)

    def test_wrong_target_revision_replay_or_event_fail(self):
        changes = [('GITHUB_REPOSITORY', 'foreign/repo'), ('GITHUB_RUN_ATTEMPT', '2'),
            ('GITHUB_EVENT_NAME', 'pull_request'), ('GITHUB_REF_TYPE', 'branch'),
            ('LINO_BACKUP_PROJECT_REF', 'a' * 20), ('LINO_CANDIDATE_APPROVED_SHA', 'b' * 40),
            ('LINO_CANDIDATE_CAPTURE_ENABLED', 'false'), ('LINO_CANDIDATE_ACK', 'release-approved'),
            ('LINO_CANDIDATE_EXPIRES_UTC', '2026-09-20T01:10:00Z'),
            ('LINO_CANDIDATE_EXPIRES_UTC', '2026-09-20T02:00:01Z')]
        for key, value in changes:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                candidate.authorize({**self.env, key:value}, self.event, self.now)
        for key, value in [('created',False), ('deleted',True), ('forced',True),
                           ('after','b'*40), ('ref','refs/heads/main')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                candidate.authorize(self.env, {**self.event, key:value}, self.now)

    def test_future_tag_and_old_window_fail(self):
        for now in [self.now - dt.timedelta(hours=1), self.now + dt.timedelta(hours=1)]:
            with self.assertRaises(ValueError):
                candidate.authorize(self.env, self.event, now)


if __name__ == '__main__':
    unittest.main()
