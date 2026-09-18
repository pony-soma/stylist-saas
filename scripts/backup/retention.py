#!/usr/bin/env python3
"""OFFLINE dry-run only. Never imports cloud SDKs or deletes files/objects.

CLI: retention.py --project-ref REF --inventory inventory.json
                 --manifests owner-decrypted-directory [--now UTC_TIMESTAMP]
Inventory exact shape: {format:1, project_ref:REF, prefix:PREFIX,
 complete:true, quiescent:true, captured_at:'...Z', objects:[
 {key:KEY,size:POSITIVE_INT,last_modified:'...Z',cipher_sha256:HEX,
 plain_sha256:HEX}]}. This is an operator assertion, not verified cloud state.
Every complete.manifest.age must have exactly one locally decrypted *.json file,
with original bytes preserved (plaintext SHA must match inventory). Include ALL
complete manifests, not only recent ones. No private keys are accepted.
Output candidates are proposals, NEVER a deletion instruction/executable plan.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import sys

MAX_INPUT = 64 * 1024 * 1024
MAX_OBJECTS = 100000
UTC = dt.timezone.utc
HEX = re.compile(r'[a-f0-9]{64}')
RUN = r'([0-9]{8}T[0-9]{6}Z-[a-f0-9]{32})'


class Refused(Exception):
    pass


def require(condition):
    if not condition:
        raise Refused('invalid or incomplete retention evidence')


def timestamp(value):
    require(isinstance(value, str) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', value)))
    try:
        return dt.datetime.fromisoformat(value[:-1] + '+00:00')
    except ValueError:
        raise Refused('invalid timestamp') from None


def unique_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result)
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs)


def plan(inventory, manifests, project_ref, now):
    """manifests is a list of ORIGINAL decrypted JSON bytes, not dicts."""
    require(isinstance(project_ref, str) and re.fullmatch(r'[a-z]{20}', project_ref))
    require(isinstance(now, dt.datetime) and now.tzinfo == UTC)
    prefix = 'lino-backup/v1/' + project_ref + '/'
    require(isinstance(inventory, dict) and set(inventory) == {'format','project_ref','prefix','complete','quiescent','captured_at','objects'})
    require(type(inventory['format']) is int and inventory['format'] == 1)
    require(inventory['project_ref'] == project_ref and inventory['prefix'] == prefix)
    require(inventory['complete'] is True and inventory['quiescent'] is True)
    captured = timestamp(inventory['captured_at'])
    require(captured <= now <= captured + dt.timedelta(hours=1))
    require(isinstance(inventory['objects'], list) and len(inventory['objects']) <= MAX_OBJECTS)
    objects, runs, photos = {}, {}, set()
    for obj in inventory['objects']:
        require(isinstance(obj, dict) and set(obj) == {'key','size','last_modified','cipher_sha256','plain_sha256'})
        key = obj['key']
        require(isinstance(key, str) and key.startswith(prefix) and key not in objects)
        require(type(obj['size']) is int and obj['size'] > 0)
        require(all(isinstance(obj[h], str) and HEX.fullmatch(obj[h]) for h in ('cipher_sha256','plain_sha256')))
        modified = timestamp(obj['last_modified'])
        require(modified <= captured)
        item = dict(obj, modified=modified)
        suffix = key[len(prefix):]
        match = re.fullmatch('runs/' + RUN + r'/(database\.age|complete\.manifest\.age)', suffix)
        if match:
            run, kind = match.groups()
            try:
                started = dt.datetime.strptime(run[:16], '%Y%m%dT%H%M%SZ').replace(tzinfo=UTC)
            except ValueError:
                raise Refused('invalid run ID') from None
            require(started <= modified <= captured)
            runs.setdefault(run, {})[kind] = key
        else:
            require(re.fullmatch(r'photos/[a-f0-9]{64}\.age', suffix))
            photos.add(key)
        objects[key] = item
    require(isinstance(manifests, list) and len(manifests) <= MAX_OBJECTS)
    require(all(isinstance(raw, bytes) for raw in manifests) and sum(map(len, manifests)) <= MAX_INPUT)
    snapshots = {}
    reference_hashes = {}
    def verify_reference(ref, expected_key=None):
        require(isinstance(ref, dict) and set(ref) == {'key','cipher_sha256','plain_sha256'})
        key = ref['key']
        require(isinstance(key, str) and key in objects)
        if expected_key is not None:
            require(key == expected_key)
        values = tuple(ref[x] for x in ('cipher_sha256','plain_sha256'))
        require(values == tuple(objects[key][x] for x in ('cipher_sha256','plain_sha256')))
        require(key not in reference_hashes or reference_hashes[key] == values)
        reference_hashes[key] = values
        return key
    for raw in manifests:
        manifest = unique_json(raw)
        require(isinstance(manifest, dict))
        fields = {'format','run_id','project_ref','atomic_snapshot','photos','database','plaintext_bytes_downloaded'}
        require(type(manifest.get('format')) is int and manifest['format'] in (1,2))
        if manifest['format'] == 2:
            fields.add('database_format')
            require(manifest.get('database_format') == 'supabase-cli-platform-v1')
        require(set(manifest) == fields and manifest['project_ref'] == project_ref)
        require(manifest['atomic_snapshot'] is False)
        require(type(manifest['plaintext_bytes_downloaded']) is int and manifest['plaintext_bytes_downloaded'] > 0)
        run = manifest['run_id']
        require(isinstance(run, str) and run in runs and run not in snapshots)
        require(set(runs[run]) == {'database.age','complete.manifest.age'})
        marker = runs[run]['complete.manifest.age']
        require(hashlib.sha256(raw).hexdigest() == objects[marker]['plain_sha256'])
        database = verify_reference(manifest['database'], runs[run]['database.age'])
        refs = {marker, database}
        require(isinstance(manifest['photos'], list) and len(manifest['photos']) <= MAX_OBJECTS)
        for photo in manifest['photos']:
            require(isinstance(photo, dict) and set(photo) == {'source','object'} and isinstance(photo['source'], dict))
            key = verify_reference(photo['object'])
            require(key in photos and key not in refs)
            refs.add(key)
        completed = objects[marker]['modified']
        require(all(objects[key]['modified'] <= completed for key in refs))
        snapshots[run] = {'refs': refs, 'completed': completed}
    require(set(snapshots) == {run for run, keys in runs.items() if 'complete.manifest.age' in keys})
    require(snapshots)  # never propose pruning without a complete known snapshot
    ordered = sorted(snapshots, key=lambda r: (snapshots[r]['completed'],r), reverse=True)
    retained = {}
    def keep(run, reason):
        retained.setdefault(run, []).append(reason)
    for run in ordered:
        if snapshots[run]['completed'] >= now - dt.timedelta(days=30):
            keep(run, 'within_30_days')
    days, weeks = set(), set()
    for run in ordered:
        date = snapshots[run]['completed'].date()
        week = date.isocalendar()[:2]
        if date not in days and len(days) < 7:
            days.add(date); keep(run, 'daily_point')
        if week not in weeks and len(weeks) < 4:
            weeks.add(week); keep(run, 'weekly_point')
    protected = set().union(*(snapshots[r]['refs'] for r in retained))
    incomplete = {r:keys for r,keys in runs.items() if r not in snapshots}
    active_grace = any(any(objects[k]['modified'] >= now-dt.timedelta(hours=48) for k in keys.values()) for keys in incomplete.values())
    kept, candidates = [], []
    for key in sorted(objects):
        if key in protected:
            reason = 'retained_snapshot_reference'
        elif objects[key]['modified'] >= now-dt.timedelta(hours=48):
            reason = '48_hour_grace'
        elif active_grace:
            reason = 'incomplete_run_grace_blocks_pruning'
        else:
            candidates.append({'key':key,'reason':'unreferenced_by_retained_snapshots_after_grace'})
            continue
        kept.append({'key':key,'reason':reason})
    return {'mode':'offline_dry_run','deletion_enabled':False,'restore_verification':'not_established','inventory_is_operator_asserted':True,
            'counts':{'objects':len(objects),'snapshots':len(snapshots),'retained_snapshots':len(retained),'kept':len(kept),'candidates':len(candidates)},
            'retained_snapshots':[{'key':runs[r]['complete.manifest.age'],'reasons':retained[r]} for r in sorted(retained)],'kept':kept,'candidates':candidates}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-ref', required=True)
    parser.add_argument('--inventory', required=True, type=Path)
    parser.add_argument('--manifests', required=True, type=Path)
    parser.add_argument('--now')
    args = parser.parse_args()
    try:
        require(args.inventory.is_file() and args.inventory.stat().st_size <= MAX_INPUT)
        require(args.manifests.is_dir())
        paths = list(args.manifests.iterdir())
        require(len(paths) <= MAX_OBJECTS and all(p.is_file() and not p.is_symlink() and p.suffix == '.json' for p in paths))
        require(sum(p.stat().st_size for p in paths) <= MAX_INPUT)
        now = timestamp(args.now) if args.now else dt.datetime.now(UTC)
        result = plan(unique_json(args.inventory.read_bytes()), [p.read_bytes() for p in paths], args.project_ref, now)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        print(json.dumps({'mode':'offline_dry_run','deletion_enabled':False,'status':'refused','candidates':[],'reason':'incomplete_invalid_or_uncertain_evidence'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
