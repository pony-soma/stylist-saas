#!/usr/bin/env python3
"""Synthetic local PostgreSQL/age/R2 rehearsal; never accesses production data.

Only writes three ephemeral objects in lino-rehearsal/v1/<random UUID>/.
--local-only exercises the same flow with an in-memory object store.
"""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

from backup import digest, require
from reconcile_photos import reconcile, Refused

ENDPOINT = 'https://6d2ceabc3375e61e0bf33705367f9dff.r2.cloudflarestorage.com'
BUCKET = 'lino-backups'
LIMIT = 2 * 1024 * 1024
FIXED_PG = {'PGHOST': '127.0.0.1', 'PGPORT': '5432', 'PGUSER': 'postgres', 'PGPASSWORD': 'postgres', 'PGDATABASE': 'postgres', 'PGSSLMODE': 'disable', 'PGCONNECT_TIMEOUT': '10'}
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=')


class Missing(Exception):
    response = {'Error': {'Code': '404'}}


class MemoryS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body):
        self.objects[(Bucket, Key)] = Body

    def get_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise Missing()
        return {'Body': io.BytesIO(self.objects[(Bucket, Key)])}

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise Missing()
        return {'ContentLength': len(self.objects[(Bucket, Key)])}

    def delete_object(self, Bucket, Key):
        self.objects.pop((Bucket, Key), None)


def missing(s3, key):
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
    except Exception as exc:
        require(getattr(exc, 'response', {}).get('Error', {}).get('Code') in ('404', 'NoSuchKey', 'NotFound'))
        return
    raise RuntimeError('expected missing object')


def child_env():
    require(os.environ.get('CI') == 'true' and os.environ.get('LINO_REHEARSAL_ENABLED') == 'true')
    for key, value in os.environ.items():
        if key in ('PG_MAJOR', 'PG_VERSION', 'PG_SHA256', 'PGDATA'):
            continue  # PostgreSQL image metadata; never passed to subprocesses
        if key.startswith('PG') and value:
            require(key in FIXED_PG and value == FIXED_PG[key])
        if key.startswith(('SUPABASE_', 'NEXT_PUBLIC_SUPABASE_', 'LINO_BACKUP_')) and value:
            raise RuntimeError('production configuration forbidden')
        if key in ('DATABASE_URL', 'POSTGRES_URL', 'AGE_SECRET_KEY', 'AGE_IDENTITY', 'AGE_RECIPIENT') and value:
            raise RuntimeError('external database or identity forbidden')
    env = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL') if k in os.environ}
    env.update(FIXED_PG)
    return env


def command(args, env, data=None, check=True):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, timeout=120)
    if check:
        require(result.returncode == 0)
    return result


def sql(query, env, database='postgres'):
    return command(['psql', '-X', '--no-password', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-At', '-d', database], env, query.encode()).stdout.decode().strip()


def encrypt(source, target, recipient, env):
    command(['age', '--encrypt', '--recipient', recipient, '--output', str(target), str(source)], env)
    require(target.read_bytes().startswith(b'age-encryption.org/v1\n'))
    source.unlink()


def main(local_only=False):
    env = child_env()
    if local_only:
        s3 = MemoryS3()
    else:
        require(os.environ.get('R2_ENDPOINT_URL') == ENDPOINT and os.environ.get('R2_BUCKET') == BUCKET)
        require(os.environ.get('R2_ACCESS_KEY_ID') and os.environ.get('R2_SECRET_ACCESS_KEY'))
        import boto3
        from botocore.config import Config
        s3 = boto3.client('s3', endpoint_url=ENDPOINT, region_name='auto', aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'], config=Config(connect_timeout=10, read_timeout=30, retries={'max_attempts': 2}, s3={'addressing_style': 'path'}))
    suffix = uuid.uuid4().hex
    source_db, target_db, role = 'lino_rehearsal_src_' + suffix, 'lino_rehearsal_dst_' + suffix, 'lino_rehearsal_role_' + suffix
    prefix = 'lino-rehearsal/v1/' + suffix + '/'
    print('rehearsal: isolated run prefix ' + prefix, flush=True)
    created_keys, databases = [], []
    role_attempted = False
    success = False
    os.umask(0o077)
    try:
        print('rehearsal: prepare synthetic local databases', flush=True)
        require(sql("SELECT inet_server_addr() = '127.0.0.1'::inet AND inet_server_port() = 5432 AND current_user = 'postgres';", env) == 't')
        require(sql("SELECT count(*) FROM pg_roles WHERE rolname='" + role + "';", env) == '0')
        role_attempted = True
        sql('CREATE ROLE ' + role + ' NOLOGIN;', env)
        for database in (source_db, target_db):
            require(sql("SELECT count(*) FROM pg_database WHERE datname='" + database + "';", env) == '0')
            databases.append(database)
            sql('CREATE DATABASE ' + database + ';', env)
        sql("CREATE TABLE public.rehearsal_notes (id integer PRIMARY KEY, owner_id text NOT NULL, body text NOT NULL); INSERT INTO public.rehearsal_notes VALUES (1,'owner','synthetic only'),(2,'other','synthetic second'); ALTER TABLE public.rehearsal_notes ENABLE ROW LEVEL SECURITY; CREATE POLICY owner_read ON public.rehearsal_notes FOR SELECT TO " + role + " USING (owner_id = current_setting('rehearsal.owner', true)); GRANT USAGE ON SCHEMA public TO " + role + '; GRANT SELECT ON public.rehearsal_notes TO ' + role + ';', env, source_db)
        sql("CREATE TABLE public.record_photos (id integer PRIMARY KEY, storage_path text NOT NULL); INSERT INTO public.record_photos VALUES (1, 'synthetic/photo.png');", env, source_db)
        with tempfile.TemporaryDirectory(prefix='lino-rehearsal-') as temporary:
            folder = Path(temporary)
            env['HOME'] = str(folder)
            identity, wrong = folder / 'identity', folder / 'wrong-identity'
            command(['age-keygen', '-o', str(identity)], env)
            command(['age-keygen', '-o', str(wrong)], env)
            recipient = command(['age-keygen', '-y', str(identity)], env).stdout.decode().strip()
            dump, photo = folder / 'database.dump', folder / 'photo.png'
            command(['pg_dump', '--no-password', '--format=custom', '--lock-wait-timeout=10s', '--file', str(dump), '--dbname', source_db], env)
            photo.write_bytes(PNG)
            manifest = {'format': 1, 'synthetic': True, 'objects': []}
            total = 0
            print('rehearsal: encrypt and upload synthetic artifacts', flush=True)
            for name, path in [('database', dump), ('photo', photo)]:
                plain_hash = digest(path)
                ciphertext = folder / (name + '.age')
                encrypt(path, ciphertext, recipient, env)
                data = ciphertext.read_bytes()
                total += len(data)
                require(total < LIMIT and len(created_keys) < 2)
                key = prefix + name + '.age'
                missing(s3, key)
                created_keys.append(key)  # cleanup also covers ambiguous PUT failures
                s3.put_object(Bucket=BUCKET, Key=key, Body=data)
                manifest['objects'].append({'name': name, 'key': key, 'cipher_sha256': digest(ciphertext), 'plain_sha256': plain_hash})
            plaintext_manifest = folder / 'manifest.json'
            # Synthetic adapter: real rehearsal objects stay in their authorized
            # lino-rehearsal prefix. The reconciliation fixture uses a logical
            # backup key; never fetch or upload this key to a cloud service.
            photo_evidence = next(obj for obj in manifest['objects'] if obj['name'] == 'photo')
            fixture_ref = 'a' * 20
            logical_key = 'lino-backup/v1/' + fixture_ref + '/photos/' + hashlib.sha256(b'synthetic-photo').hexdigest() + '.age'
            manifest['photo_reconciliation'] = {
                'format': 1, 'project_ref': fixture_ref, 'atomic_snapshot': False,
                'photos': [{'source': {'path': 'synthetic/photo.png', 'metadata': {'size': len(PNG)}},
                            'object': {'key': logical_key, 'plain_sha256': photo_evidence['plain_sha256']}}]}
            plaintext_manifest.write_text(json.dumps(manifest), encoding='utf-8')
            manifest_plain_hash = digest(plaintext_manifest)
            encrypted_manifest = folder / 'complete.manifest.age'
            encrypt(plaintext_manifest, encrypted_manifest, recipient, env)
            data = encrypted_manifest.read_bytes()
            total += len(data)
            require(total < LIMIT and len(created_keys) == 2)
            key = prefix + 'complete.manifest.age'
            missing(s3, key)
            created_keys.append(key)
            s3.put_object(Bucket=BUCKET, Key=key, Body=data)
            def download(object_key, output, expected_hash):
                require(object_key in created_keys)
                response = s3.get_object(Bucket=BUCKET, Key=object_key)
                try:
                    contents = response['Body'].read(LIMIT + 1)
                finally:
                    response['Body'].close()
                require(len(contents) < LIMIT)
                output.write_bytes(contents)
                require(digest(output) == expected_hash)
            print('rehearsal: download, verify hashes, decrypt', flush=True)
            fetched_manifest = folder / 'fetched-manifest.age'
            download(key, fetched_manifest, digest(encrypted_manifest))
            decrypted_manifest = folder / 'verified-manifest.json'
            command(['age', '--decrypt', '-i', str(identity), '-o', str(decrypted_manifest), str(fetched_manifest)], env)
            require(digest(decrypted_manifest) == manifest_plain_hash)
            require(json.loads(decrypted_manifest.read_text()) == manifest)
            for obj in json.loads(decrypted_manifest.read_text())['objects']:
                fetched = folder / ('fetched-' + obj['name'] + '.age')
                output = folder / ('restored-' + obj['name'])
                download(obj['key'], fetched, obj['cipher_sha256'])
                command(['age', '--decrypt', '-i', str(identity), '-o', str(output), str(fetched)], env)
                require(digest(output) == obj['plain_sha256'])
            require((folder / 'restored-photo').read_bytes() == PNG)
            require(command(['age', '--decrypt', '-i', str(wrong), str(fetched_manifest)], env, check=False).returncode != 0)
            missing(s3, prefix + 'never-created.age')
            print('rehearsal: restore synthetic database and verify RLS/grants', flush=True)
            command(['pg_restore', '--no-password', '--exit-on-error', '--dbname', target_db, str(folder / 'restored-database')], env)
            expected = '1|owner|synthetic only\n2|other|synthetic second'
            require(sql('SELECT * FROM public.rehearsal_notes ORDER BY id;', env, target_db) == expected)
            require(sql("SELECT relrowsecurity FROM pg_class WHERE oid='public.rehearsal_notes'::regclass;", env, target_db) == 't')
            require(sql("SELECT has_table_privilege('" + role + "','public.rehearsal_notes','SELECT') AND NOT has_table_privilege('" + role + "','public.rehearsal_notes','UPDATE');", env, target_db) == 't')
            for owner, count in [('owner', '1'), ('stranger', '0')]:
                result = sql('SET ROLE ' + role + "; SET rehearsal.owner='" + owner + "'; SELECT count(*) FROM public.rehearsal_notes;", env, target_db)
                require(result.splitlines()[-1] == count)
            print('rehearsal: reconcile restored DB photo references and decrypted bytes', flush=True)
            refs = json.loads(sql("SELECT coalesce(json_agg(storage_path ORDER BY id), '[]'::json) FROM public.record_photos;", env, target_db))
            require(refs == ['synthetic/photo.png'])
            evidence = json.loads(decrypted_manifest.read_text())['photo_reconciliation']
            object_dir = folder / 'reconciliation-objects'
            object_dir.mkdir(mode=0o700)
            evidence_key = evidence['photos'][0]['object']['key']
            checked_photo = object_dir / (hashlib.sha256(evidence_key.encode()).hexdigest() + '.plain')
            checked_photo.write_bytes((folder / 'restored-photo').read_bytes())
            audit = reconcile(evidence, refs, object_dir, fixture_ref)
            require(audit['verified_objects'] == 1 and audit['referenced_photos'] == 1 and not audit['source_quiescence_verified'])
            # Same-size damage must fail even though a byte-count-only check passes.
            damaged = bytearray(checked_photo.read_bytes())
            damaged[-1] ^= 1
            checked_photo.write_bytes(damaged)
            try:
                reconcile(evidence, refs, object_dir, fixture_ref)
            except Refused:
                pass
            else:
                raise RuntimeError('corrupt restored photo accepted')
            checked_photo.write_bytes((folder / 'restored-photo').read_bytes())
            # Source reference must come from the restored database, not a static
            # expected fixture list. A dangling reference must fail the audit.
            sql("INSERT INTO public.record_photos VALUES (2, 'synthetic/missing.png');", env, target_db)
            broken_refs = json.loads(sql('SELECT json_agg(storage_path ORDER BY id) FROM public.record_photos;', env, target_db))
            try:
                reconcile(evidence, broken_refs, object_dir, fixture_ref)
            except Refused:
                pass
            else:
                raise RuntimeError('missing restored photo accepted')
            success = True
    finally:
        print('rehearsal: clean up only this run', flush=True)
        cleanup_errors = []
        for key in created_keys:
            try:
                require(key.startswith(prefix) and key in (prefix + 'database.age', prefix + 'photo.age', prefix + 'complete.manifest.age'))
                s3.delete_object(Bucket=BUCKET, Key=key)
                missing(s3, key)
            except Exception:
                cleanup_errors.append('object')
        for database in reversed(databases):
            try:
                sql('DROP DATABASE IF EXISTS ' + database + ' WITH (FORCE);', env)
                require(sql("SELECT count(*) FROM pg_database WHERE datname='" + database + "';", env) == '0')
            except Exception:
                cleanup_errors.append('database')
        if role_attempted:
            try:
                sql('DROP ROLE IF EXISTS ' + role + ';', env)
                require(sql("SELECT count(*) FROM pg_roles WHERE rolname='" + role + "';", env) == '0')
            except Exception:
                cleanup_errors.append('role')
        require(not cleanup_errors)
    require(success)
    print('rehearsal: PASS; synthetic restore, hashes, RLS, negative cases, cleanup verified', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--local-only', action='store_true')
    args = parser.parse_args()
    try:
        main(args.local_only)
    except Exception:
        print('rehearsal: FAILED; inspect last stage and verify cleanup before retry. No production data was used.', file=sys.stderr)
        sys.exit(1)
