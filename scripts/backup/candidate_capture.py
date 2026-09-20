#!/usr/bin/env python3
"""Approved candidate capture only; never a cutover or quiescence claim."""
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys


def authorize(env, event, now=None):
    """Fail closed before importing the backup runner or contacting a service."""
    now = now or dt.datetime.now(dt.timezone.utc)
    sha = env.get('GITHUB_SHA', '')
    ref = env.get('GITHUB_REF', '')
    match = re.fullmatch(r'refs/tags/lino-candidate-(\d{8}T\d{6}Z)-([a-f0-9]{12})', ref)
    checks = (
        env.get('GITHUB_REPOSITORY') == 'pony-soma/stylist-saas',
        env.get('GITHUB_EVENT_NAME') == 'push',
        env.get('GITHUB_REF_TYPE') == 'tag',
        env.get('GITHUB_RUN_ATTEMPT') == '1',
        env.get('LINO_CANDIDATE_CAPTURE_ENABLED') == 'true',
        env.get('LINO_CANDIDATE_ACK') == 'candidate-only-not-cutover-recovery',
        bool(re.fullmatch(r'[a-f0-9]{40}', sha)),
        sha == env.get('LINO_CANDIDATE_APPROVED_SHA'),
        ref == env.get('LINO_CANDIDATE_APPROVED_REF'),
        env.get('LINO_BACKUP_PROJECT_REF') == 'pprlqowossudjvtgkfir',
        event.get('ref') == ref,
        event.get('after') == sha,
        event.get('created') is True,
        event.get('deleted') is False,
        event.get('forced') is False,
    )
    if not all(checks) or not match or match[2] != sha[:12]:
        raise ValueError('Candidate capture authorization rejected')
    created = dt.datetime.strptime(match[1], '%Y%m%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc)
    expires = dt.datetime.strptime(env.get('LINO_CANDIDATE_EXPIRES_UTC', ''), '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)
    # The tag timestamp and approval must describe a short, current window.
    if not created <= now < expires <= created + dt.timedelta(hours=1):
        raise ValueError('Candidate capture approval is outside its window')


def main():
    try:
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
        authorize(os.environ, event)
        if sys.argv[1:] == ['--check-only']:
            print('Candidate capture authorization checks passed; no source accessed.')
            return 0
        if sys.argv[1:]:
            raise ValueError('Invalid arguments')
        import backup
        # One supervised candidate run does not enable the regular backup job.
        os.environ['LINO_BACKUP_ENABLED'] = 'true'
        result = backup.main()
        if result == 0:
            print('Candidate transfer complete. Atomicity, restore and cutover readiness are NOT established.')
        return result
    except Exception:
        print('Candidate capture refused or failed; no recovery success should be inferred.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
