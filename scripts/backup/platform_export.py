#!/usr/bin/env python3
"""Read-only Supabase CLI filtered logical export; not a hosted restore tool.

Plaintext must remain in an owner-only temporary directory and be encrypted by
its caller immediately. The bundle is a recovery candidate, never evidence that
hosted restore gates have been resolved. No connections occur at import time.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import stat
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import quote

FORMAT = 'supabase-cli-platform-v1'
CLI_VERSION = '2.117.0'
# pg_dump ACL commands assume built-in PostgreSQL defaults. Supabase's target
# public defaults would otherwise add grants before source ACLs are applied.
# This is an explicit, fail-closed step for a fresh target, never source execution.
PRE_RESTORE_SQL = """-- Run after roles.sql and before schema.sql in the same restore transaction.
DO $lino_restore_defaults$
DECLARE
    entry record;
    object_kind text;
    grantee_name text;
BEGIN
    IF current_user <> 'postgres' OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND rolsuper
    ) THEN
        RAISE EXCEPTION 'Platform restore requires ordinary postgres';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass
            AND d.objid=p.oid AND d.deptype='e'
        )
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname='public' AND t.typtype IN ('c','d','e','r','m') AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_type'::regclass
            AND d.objid=t.oid AND d.deptype='e'
        )
    ) THEN
        RAISE EXCEPTION 'Platform restore requires fresh public schema';
    END IF;
    -- Per-schema REVOKE cannot remove global default grants. Do not guess.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_default_acl
        WHERE defaclrole='postgres'::regrole AND defaclnamespace=0
    ) THEN
        RAISE EXCEPTION 'Review global postgres default privileges before restore';
    END IF;
    FOR entry IN
        SELECT DISTINCT d.defaclobjtype,a.grantee
        FROM pg_catalog.pg_default_acl d
        CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
        WHERE d.defaclrole='postgres'::regrole
          AND d.defaclnamespace='public'::regnamespace
    LOOP
        object_kind := CASE entry.defaclobjtype
            WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
            WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES' ELSE NULL END;
        IF object_kind IS NULL THEN
            RAISE EXCEPTION 'Unsupported public default privilege object type';
        END IF;
        grantee_name := CASE WHEN entry.grantee=0 THEN 'PUBLIC'
            ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(entry.grantee)) END;
        EXECUTE pg_catalog.format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON %s FROM %s',
            object_kind,grantee_name
        );
    END LOOP;
END;
$lino_restore_defaults$;
"""

RESTORE_GATES = [
    'Review and separately restore custom auth/storage definitions against a pristine same-version target; default CLI schema export excludes them.',
    'Resolve Vault/pgsodium/column encryption and encryption root keys before restoring; encrypted SQL rows alone are insufficient.',
    'Match extensions, platform versions, Auth/SMTP/OAuth settings, webhooks, Realtime publications and custom LOGIN-role passwords.',
    'Restore Storage object bytes separately; database metadata is not a file backup.',
    'Verify a fresh hosted target with its ordinary postgres role, same-password Auth login and application RLS before approving recovery.',
]


class PlatformExportError(Exception):
    pass


def require(condition):
    if not condition:
        raise PlatformExportError('platform export precondition or verification failed')


def connection_environment(env):
    """Accept only the configured hosted project or the fixed synthetic CI source."""
    host, user = env.get('PGHOST', ''), env.get('PGUSER', '')
    port = env.get('PGPORT', '5432')
    ref = env.get('LINO_BACKUP_PROJECT_REF', '')
    local = (env.get('CI') == 'true' and env.get('LINO_E2E_LOCAL') == '1'
             and host == '127.0.0.1' and port == '54322' and user == 'postgres'
             and env.get('NEXT_PUBLIC_SUPABASE_URL') == 'http://127.0.0.1:54321')
    direct = host == 'db.' + ref + '.supabase.co' and user == 'postgres'
    pooler = (re.fullmatch(r'aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com', host)
              and user == 'postgres.' + ref)
    hosted = (env.get('LINO_BACKUP_ENABLED') == 'true' and re.fullmatch('[a-z]{20}', ref)
              and env.get('SUPABASE_URL') == 'https://' + ref + '.supabase.co'
              and port == '5432' and (direct or pooler)
              and env.get('PGSSLMODE') in ('require', 'verify-full'))
    require(local or hosted)
    require(env.get('PGDATABASE') == 'postgres' and bool(env.get('PGPASSWORD')))
    # Deliberately exclude unrelated cloud credentials and psql startup settings.
    child = {key: env[key] for key in ('PATH', 'HOME', 'LANG', 'SYSTEMROOT') if key in env}
    child.update({key: env[key] for key in ('PGHOST', 'PGUSER', 'PGDATABASE', 'PGPASSWORD')})
    if env.get('PGSSLROOTCERT'):
        child['PGSSLROOTCERT'] = env['PGSSLROOTCERT']
    child.update(PGPORT=port, PGSSLMODE='disable' if local else env['PGSSLMODE'],
                 PGCONNECT_TIMEOUT='15', PGOPTIONS='-c default_transaction_read_only=on')
    # CLI honors PGPASSWORD. Passwords never occur in command-line arguments.
    url = f'postgresql://{quote(user, safe="")}@{host}:{port}/postgres?sslmode={child["PGSSLMODE"]}'
    return child, url


def _run(command, env, limit, capture=False):
    def constrain():
        os.umask(0o077)
        resource.setrlimit(resource.RLIMIT_FSIZE, (limit, limit))
    try:
        result = subprocess.run(command, env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                                stderr=subprocess.PIPE, timeout=300, check=True,
                                preexec_fn=constrain)
        if capture:
            require(len(result.stdout) <= limit)
        return result.stdout if capture else None
    except Exception:
        # CLI exceptions contain argv and connection details; never propagate them.
        raise PlatformExportError('platform export subprocess failed') from None


def export_platform(target, limit, env=None, cli=('npx', '--no-install', 'supabase'), data_mode='copy'):
    """Write a bounded plaintext tar and return non-secret format/gate metadata."""
    env = dict(os.environ if env is None else env)
    require(data_mode in ('copy', 'inserts'))
    target = Path(target)
    require(isinstance(limit, int) and not isinstance(limit, bool) and limit > 0)
    require(target.parent.is_dir() and not target.parent.is_symlink())
    directory_stat = target.parent.stat()
    require(directory_stat.st_uid == os.getuid() and stat.S_IMODE(directory_stat.st_mode) & 0o077 == 0)
    require(not target.exists() and not target.is_symlink())
    child, url = connection_environment(env)
    version = _run([*cli, '--version'], child, limit, capture=True).decode().strip()
    require(version == CLI_VERSION)
    # Every DB operation uses the ordinary project role, including inventory.
    inventory_sql = "SELECT json_build_object('role',current_user,'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'history',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='supabase_migrations'),'hooks_table',to_regclass('supabase_functions.hooks') IS NOT NULL,'hooks_sequence',to_regclass('supabase_functions.hooks_id_seq') IS NOT NULL,'webhook_dependencies',EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE NOT t.tgisinternal AND n.nspname='supabase_functions') OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','supabase_functions') AND CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ILIKE '%supabase_functions%' ELSE false END))::text"
    inventory = json.loads(_run(['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', inventory_sql], child, limit, capture=True))
    require(inventory.get('role') == 'postgres' and inventory.get('superuser') is False)
    # CLI excludes managed webhook DDL but can emit its empty sequence setval.
    # Omit only a demonstrably unused initial sequence. Never discard hook rows
    # or pretend configured platform webhooks are portable to an absent target.
    require(inventory.get('webhook_dependencies') is False)
    hooks_present = inventory.get('hooks_table')
    sequence_present = inventory.get('hooks_sequence')
    require(isinstance(hooks_present, bool) and isinstance(sequence_present, bool))
    require(hooks_present == sequence_present)
    sequence_exclusions = []
    webhook_state = 'absent'
    if hooks_present:
        guard_sql = "SELECT json_build_object('hooks_guard',true,'empty',NOT EXISTS(SELECT 1 FROM supabase_functions.hooks),'initial',last_value=1 AND NOT is_called)::text FROM supabase_functions.hooks_id_seq"
        guard = json.loads(_run(['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', guard_sql], child, limit, capture=True))
        require(guard.get('empty') is True and guard.get('initial') is True)
        sequence_exclusions = ['--exclude', 'supabase_functions.hooks_id_seq']
        webhook_state = 'empty-unused; initial managed sequence omitted'
    report = {'database_format': FORMAT, 'cli_version': version, 'hosted_restore_verified': False, 'data_mode': data_mode,
              'restore_gates': RESTORE_GATES.copy(), 'migration_history': 'included' if inventory['history'] else 'absent',
              'managed_webhook_state': webhook_state,
              'snapshot_consistency': 'separate CLI exports; quiesce application writes for a recovery point', 'files': {}}
    created = False
    try:
        with tempfile.TemporaryDirectory(prefix='platform-', dir=target.parent) as raw:
            folder = Path(raw)
            data_flags = ['--data-only'] + (['--use-copy'] if data_mode == 'copy' else [])
            specs = [('roles.sql', ['--role-only']), ('schema.sql', []),
                     ('data.sql', [*data_flags, '--exclude', 'storage.buckets_vectors', '--exclude', 'storage.vector_indexes', *sequence_exclusions])]
            if inventory['history']:
                specs.extend([('history_schema.sql', ['--schema', 'supabase_migrations']),
                              ('history_data.sql', ['--schema', 'supabase_migrations', *data_flags])])
            preparation = folder / 'pre_restore.sql'
            preparation.write_text(PRE_RESTORE_SQL, encoding='utf-8')
            preparation.chmod(0o600)
            size = preparation.stat().st_size
            require(size < limit)
            report['files']['pre_restore.sql'] = {'bytes': size, 'sha256': hashlib.sha256(preparation.read_bytes()).hexdigest()}
            report['restore_order'] = ['roles.sql', 'pre_restore.sql', 'schema.sql']
            if inventory['history']:
                report['restore_order'].append('history_schema.sql')
            report['restore_order'].append('data.sql')
            if inventory['history']:
                report['restore_order'].append('history_data.sql')
            for name, flags in specs:
                path = folder / name
                _run([*cli, 'db', 'dump', '--db-url', url, '--file', str(path), *flags], child, limit - size)
                require(path.is_file() and not path.is_symlink())
                path.chmod(0o600)
                size += path.stat().st_size
                require(size < limit)
                report['files'][name] = {'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            if hooks_present:
                # Separate CLI exports need quiesced writers; recheck before sealing.
                guard = json.loads(_run(['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', guard_sql], child, limit, capture=True))
                require(guard.get('empty') is True and guard.get('initial') is True)
            metadata = folder / 'package.json'
            metadata.write_text(json.dumps(report, sort_keys=True), encoding='utf-8')
            metadata.chmod(0o600)
            # Exclusive create prevents replacing any caller-owned file.
            with target.open('xb') as stream:
                created = True
                target.chmod(0o600)
                with tarfile.open(fileobj=stream, mode='w') as archive:
                    for name in [*report['restore_order'], 'package.json']:
                        archive.add(folder / name, arcname=name, recursive=False)
                require(stream.tell() <= limit)
        return report
    except Exception:
        if created:
            target.unlink(missing_ok=True)
        raise PlatformExportError('platform export failed; incomplete package removed') from None


def main():
    try:
        require(len(sys.argv) == 2)
        report = export_platform(Path(sys.argv[1]), int(os.environ.get('LINO_BACKUP_MAX_BYTES', '104857600')), data_mode=os.environ.get('LINO_BACKUP_DATA_MODE', 'copy'))
        print(json.dumps({'database_format': report['database_format'], 'hosted_restore_verified': False}))
        return 0
    except Exception:
        print('Platform export failed; no complete recovery package should be inferred.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
