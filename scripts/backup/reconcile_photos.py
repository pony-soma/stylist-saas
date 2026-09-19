#!/usr/bin/env python3
"""Offline restored-photo audit. No network, credentials, writes or deletions.

references.json: JSON array of storage_path strings from ALL restored
public.record_photos rows, exported in the isolated restore target.
manifest: decrypted backup manifest; validate its provenance separately.
objects: flat private directory containing decrypted photo bytes, named
sha256(object.key UTF-8).hexdigest() + '.plain'. Never use customer paths as
local filenames. This verifies supplied evidence, NOT source quiescence.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

MAX_JSON = 16 * 1024 * 1024
MAX_PHOTOS = 1000
MAX_BYTES = 100 * 1024 * 1024


class Refused(Exception):
    pass


def require(ok):
    if not ok:
        raise Refused('photo reconciliation failed')


def read_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result)
            result[key] = value
        return result
    with open(path, 'rb') as f:
        raw = f.read(MAX_JSON + 1)
    require(len(raw) <= MAX_JSON)
    return json.loads(raw, object_pairs_hook=pairs)


def safe_path(value):
    require(isinstance(value, str) and bool(value))
    require('\\' not in value and not any(ord(c) < 32 or ord(c) == 127 for c in value))
    require(all(part not in ('', '.', '..') for part in value.split('/')))
    return value


def reconcile(manifest, references, objects, project_ref):
    require(bool(re.fullmatch(r'[a-z]{20}', project_ref)))
    require(isinstance(manifest, dict) and manifest.get('project_ref') == project_ref)
    require((type(manifest.get('format')) is int and manifest['format'] == 1) or
            (type(manifest.get('format')) is int and manifest['format'] == 2 and
             manifest.get('database_format') == 'supabase-cli-platform-v1'))
    require(manifest.get('atomic_snapshot') is False)
    require(isinstance(references, list) and len(references) <= MAX_PHOTOS)
    refs = [safe_path(path) for path in references]
    # Sharing a storage_path is ambiguous ownership in LiNo; do not silently dedupe.
    require(len(set(refs)) == len(refs))
    photos = manifest.get('photos')
    require(isinstance(photos, list) and len(photos) <= MAX_PHOTOS)
    root = Path(objects)
    require(root.is_dir() and not root.is_symlink())
    paths, keys, total = set(), set(), 0
    for photo in photos:
        path = safe_path(photo['source']['path'])
        require(path not in paths)
        paths.add(path)
        obj = photo['object']
        key = obj['key']
        prefix = 'lino-backup/v1/' + project_ref + '/photos/'
        require(isinstance(key, str) and bool(re.fullmatch(re.escape(prefix) + r'[a-f0-9]{64}\.age', key)))
        require(key not in keys)
        keys.add(key)
        expected = obj['plain_sha256']
        require(isinstance(expected, str) and bool(re.fullmatch(r'[a-f0-9]{64}', expected)))
        size = photo['source']['metadata']['size']
        require(type(size) is int and 0 <= size <= MAX_BYTES - total)
        local = root / (hashlib.sha256(key.encode()).hexdigest() + '.plain')
        require(not local.is_symlink() and local.is_file())
        h, count = hashlib.sha256(), 0
        with local.open('rb') as f:
            while True:
                chunk = f.read(min(1024 * 1024, size - count + 1))
                if not chunk:
                    break
                count += len(chunk)
                require(count <= size)
                h.update(chunk)
        require(count == size and h.hexdigest() == expected)
        total += count
    require(set(refs).issubset(paths))
    return {'status': 'passed', 'scope': 'supplied-restored-photo-evidence',
            'referenced_photos': len(refs), 'verified_objects': len(paths),
            'unreferenced_objects': len(paths - set(refs)), 'verified_bytes': total,
            'atomic_snapshot': False, 'source_quiescence_verified': False}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest', required=True)
    p.add_argument('--references', required=True)
    p.add_argument('--objects', required=True)
    p.add_argument('--project-ref', required=True)
    args = p.parse_args()
    try:
        result = reconcile(read_json(args.manifest), read_json(args.references),
                           args.objects, args.project_ref)
    except Exception:
        # Never disclose source paths, customer identifiers, or exception text.
        print(json.dumps({'status': 'failed', 'code': 'PHOTO_RECONCILIATION_FAILED'}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
