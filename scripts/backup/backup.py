#!/usr/bin/env python3
"""Encrypted backup runner. No restore or retention deletion is performed here.

Requires age, pg_dump and boto3. R2 bucket MUST be private; this program does not
configure or prove bucket privacy. A complete marker means transfer completed,
not that restore was rehearsed or that DB and Storage form an atomic snapshot.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import uuid


class BackupError(Exception):
    pass


def require(ok):
    if not ok:
        raise BackupError('backup precondition or verification failed')


def positive(value):
    require(str(value).isdigit() and int(value) > 0)
    return int(value)


def config(env):
    require(env.get('LINO_BACKUP_ENABLED') == 'true')
    ref = env.get('LINO_BACKUP_PROJECT_REF', '')
    require(bool(re.fullmatch(r'[a-z]{20}', ref)))
    require(env.get('SUPABASE_URL') == 'https://' + ref + '.supabase.co')
    host, user = env.get('PGHOST', ''), env.get('PGUSER', '')
    direct = host == 'db.' + ref + '.supabase.co' and user == 'postgres'
    pooler = bool(re.fullmatch(r'aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com', host)) and user == 'postgres.' + ref
    require(direct or pooler)
    require(env.get('PGSSLMODE') in ('require', 'verify-full'))
    require(env.get('PGDATABASE') == 'postgres')
    require(env.get('PGPORT', '5432') == '5432')  # session mode only
    require(bool(re.fullmatch(r'https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com', env.get('R2_ENDPOINT_URL', ''))))
    require(bool(re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', env.get('R2_BUCKET', ''))))
    require(bool(re.fullmatch(r'age1[0-9a-z]{58}', env.get('AGE_RECIPIENT', ''))))
    for key in ('PGPASSWORD', 'SUPABASE_SERVICE_ROLE_KEY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'):
        require(bool(env.get(key)))
    return {'ref': ref, 'url': env['SUPABASE_URL'], 'token': env['SUPABASE_SERVICE_ROLE_KEY'],
            'bucket': env['R2_BUCKET'], 'recipient': env['AGE_RECIPIENT'],
            'limit': positive(env.get('LINO_BACKUP_MAX_BYTES', '104857600')),
            'stored_limit': positive(env.get('LINO_BACKUP_MAX_STORED_BYTES', '8589934592')),
            'max_photos': positive(env.get('LINO_BACKUP_MAX_PHOTOS', '1000'))}


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise BackupError('redirect refused')


class Storage:
    def __init__(self, cfg):
        self.cfg = cfg
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, path, data=None):
        headers = {'apikey': self.cfg['token'], 'Authorization': 'Bearer ' + self.cfg['token']}
        if data is not None:
            headers['Content-Type'] = 'application/json'
            data = json.dumps(data).encode()
        req = urllib.request.Request(self.cfg['url'] + path, data=data, headers=headers)
        return self.opener.open(req, timeout=60)

    def listing(self):
        result, folders, visited = [], [''], set()
        while folders:
            prefix = folders.pop()
            require(prefix not in visited and len(visited) <= self.cfg['max_photos'] + 100)
            visited.add(prefix)
            offset = 0
            while True:
                with self.request('/storage/v1/object/list/record-photos', {'prefix': prefix, 'limit': 100, 'offset': offset, 'sortBy': {'column': 'name', 'order': 'asc'}}) as response:
                    raw = response.read(2 * 1024 * 1024 + 1)
                require(len(raw) <= 2 * 1024 * 1024)
                page = json.loads(raw)
                require(isinstance(page, list) and len(page) <= 100)
                for entry in page:
                    name = entry['name']
                    require(isinstance(name, str) and name not in ('', '.', '..') and '/' not in name)
                    path = prefix + name
                    if entry.get('id') is None:
                        folders.append(path + '/')
                    else:
                        require(isinstance(entry.get('metadata'), dict))
                        require(entry.get('updated_at') and entry.get('created_at'))
                        result.append({'path': path, 'id': entry['id'], 'updated_at': entry['updated_at'], 'created_at': entry['created_at'], 'metadata': entry['metadata']})
                        require(len(result) <= self.cfg['max_photos'])
                offset += len(page)
                require(offset <= self.cfg['max_photos'] + 1000)
                if len(page) < 100:
                    break
        result.sort(key=lambda x: x['path'])
        require(len({x['path'] for x in result}) == len(result))
        return result

    def download(self, entry, target, remaining):
        expected = entry['metadata'].get('size')
        require(isinstance(expected, int) and not isinstance(expected, bool) and 0 <= expected <= remaining)
        total = 0
        url = '/storage/v1/object/authenticated/record-photos/' + urllib.parse.quote(entry['path'], safe='/')
        with self.request(url) as response, open(target, 'xb') as out:
            while True:
                block = response.read(min(1024 * 1024, remaining - total + 1))
                if not block:
                    break
                total += len(block)
                require(total <= remaining)
                out.write(block)
        require(total == expected)
        return total


def encrypt(source, destination, recipient):
    subprocess.run(['age', '--encrypt', '--recipient', recipient, '--output', str(destination), str(source)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
    require(destination.is_file() and destination.stat().st_size > 0)
    with open(destination, 'rb') as f:
        require(f.read(22) == b'age-encryption.org/v1\n')
    source.unlink()


def dump_database(target, limit):
    # Bound pg_dump output as it is produced; never pass passwords on argv.
    pg_env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGSSLROOTCERT') if key in os.environ}
    pg_env.update({'PGCONNECT_TIMEOUT': '15', 'PGAPPNAME': 'lino-backup', 'PGOPTIONS': '-c statement_timeout=600000 -c lock_timeout=10000'})
    proc = subprocess.Popen(['pg_dump', '--format=custom', '--no-password', '--lock-wait-timeout=60s'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=pg_env)
    total = 0
    try:
        with open(target, 'xb') as out:
            while True:
                block = proc.stdout.read(1024 * 1024)
                if not block:
                    break
                total += len(block)
                require(total <= limit)
                out.write(block)
        require(proc.wait(timeout=30) == 0 and total > 0)
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
    return total


def head_optional(s3, bucket, key):
    try:
        return s3.head_object(Bucket=bucket, Key=key)
    except Exception as exc:
        if getattr(exc, 'response', {}).get('Error', {}).get('Code') in ('404', 'NoSuchKey', 'NotFound'):
            return None
        raise


def upload(s3, bucket, key, path, plain_sha, budget):
    require(budget['used'] + path.stat().st_size <= budget['limit'])
    budget['used'] += path.stat().st_size
    cipher_sha = digest(path)
    metadata = {'cipher-sha256': cipher_sha, 'plain-sha256': plain_sha}
    s3.upload_file(str(path), bucket, key, ExtraArgs={'ContentType': 'application/octet-stream', 'Metadata': metadata})
    head = s3.head_object(Bucket=bucket, Key=key)
    require(head.get('ContentLength') == path.stat().st_size and head.get('Metadata') == metadata)
    return {'key': key, 'cipher_sha256': cipher_sha, 'plain_sha256': plain_sha}


def run(cfg, s3, storage):
    os.umask(0o077)
    run_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex
    prefix = 'lino-backup/v1/' + cfg['ref'] + '/'
    budget = {'used': 0, 'limit': cfg['stored_limit']}
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=cfg['bucket'], Prefix=prefix):
        for obj in page.get('Contents', []):
            budget['used'] += obj['Size']
            require(budget['used'] <= budget['limit'])
    before = storage.listing()
    manifest = {'format': 1, 'run_id': run_id, 'project_ref': cfg['ref'], 'atomic_snapshot': False, 'photos': []}
    with tempfile.TemporaryDirectory(prefix='lino-backup-') as temp:
        folder = Path(temp)
        plain, encrypted = folder / 'database.dump', folder / 'database.age'
        transferred = dump_database(plain, cfg['limit'])
        db_hash = digest(plain)
        encrypt(plain, encrypted, cfg['recipient'])
        manifest['database'] = upload(s3, cfg['bucket'], prefix + 'runs/' + run_id + '/database.age', encrypted, db_hash, budget)
        encrypted.unlink()
        for entry in before:
            # Key depends on recipient: key rotation never reuses old-key ciphertext.
            version = json.dumps({'entry': entry, 'recipient': cfg['recipient']}, sort_keys=True, separators=(',', ':')).encode()
            key = prefix + 'photos/' + hashlib.sha256(version).hexdigest() + '.age'
            head = head_optional(s3, cfg['bucket'], key)
            if head is not None:
                metadata = head.get('Metadata', {})
                require(head.get('ContentLength', 0) > 0 and all(re.fullmatch(r'[a-f0-9]{64}', metadata.get(k, '')) for k in ('cipher-sha256', 'plain-sha256')))
                obj = {'key': key, 'cipher_sha256': metadata['cipher-sha256'], 'plain_sha256': metadata['plain-sha256']}
            else:
                plain, encrypted = folder / 'photo', folder / 'photo.age'
                transferred += storage.download(entry, plain, cfg['limit'] - transferred)
                photo_hash = digest(plain)
                encrypt(plain, encrypted, cfg['recipient'])
                obj = upload(s3, cfg['bucket'], key, encrypted, photo_hash, budget)
                encrypted.unlink()
            manifest['photos'].append({'source': entry, 'object': obj})
        require(before == storage.listing())
        manifest['plaintext_bytes_downloaded'] = transferred
        plain, encrypted = folder / 'manifest.json', folder / 'manifest.age'
        plain.write_text(json.dumps(manifest, sort_keys=True), encoding='utf-8')
        manifest_hash = digest(plain)
        encrypt(plain, encrypted, cfg['recipient'])
        # The only completion marker is encrypted and uploaded after all checks.
        upload(s3, cfg['bucket'], prefix + 'runs/' + run_id + '/complete.manifest.age', encrypted, manifest_hash, budget)
    print(json.dumps({'status': 'complete', 'photos': len(before), 'plaintext_bytes_downloaded': transferred}))


def main():
    try:
        cfg = config(os.environ)
        require(shutil.which('age') and shutil.which('pg_dump'))
        import boto3
        from botocore.config import Config
        s3 = boto3.client('s3', endpoint_url=os.environ['R2_ENDPOINT_URL'], aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'], region_name='auto', config=Config(retries={'max_attempts': 3}, connect_timeout=15, read_timeout=60, s3={'addressing_style': 'path'}))
        run(cfg, s3, Storage(cfg))
        return 0
    except Exception:
        # Deliberately exclude SDK/HTTP/CLI exception text, paths and credentials.
        print('Backup failed; no successful backup should be inferred. Check configuration and restricted operational diagnostics.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
