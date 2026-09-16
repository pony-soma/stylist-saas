// Disposable CI infrastructure only. NOT a production backup/restore utility.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
if (process.env.CI !== 'true' || process.env.LINO_E2E_LOCAL !== '1' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('Local CI only');
const docker = args => execFileSync('docker', ['exec', '-i', 'supabase_db_lino-e2e', ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const sql = (db, query) => docker(['psql','-X','-v','ON_ERROR_STOP=1','-At','-U','postgres','-d',db,'-c',query]).trim();
const suffix = randomUUID().replaceAll('-', '');
const source = `recovery_source_${suffix}`, target = `recovery_target_${suffix}`;
let sourceCreated=false, targetCreated=false;
try {
 sql('postgres', `CREATE DATABASE ${source}`); sourceCreated=true;
 sql('postgres', `CREATE DATABASE ${target}`); targetCreated=true;
 sql(source, `CREATE TABLE public.records(id integer PRIMARY KEY, owner_id text NOT NULL, memo text NOT NULL);
 INSERT INTO public.records VALUES (1,'owner-a','復元テスト'),(2,'owner-b','別の所有者');
 ALTER TABLE public.records ENABLE ROW LEVEL SECURITY;
 CREATE POLICY owner_read ON public.records FOR SELECT TO authenticated USING(owner_id=current_setting('recovery.owner',true));
 GRANT SELECT ON public.records TO authenticated;`);
 // Dump includes schema, rows, grants and policies. Stored only in the CI process.
 const dump=execFileSync('docker',['exec','supabase_db_lino-e2e','pg_dump','-U','postgres','-d',source,'-Fc']);
 assert.ok(dump.length>0);
 execFileSync('docker',['exec','-i','supabase_db_lino-e2e','pg_restore','-U','postgres','-d',target,'--exit-on-error'],{input:dump,stdio:['pipe','pipe','pipe']});
 assert.equal(sql(target, 'SELECT json_agg(records ORDER BY id)::text FROM public.records'), sql(source, 'SELECT json_agg(records ORDER BY id)::text FROM public.records'));
 const visible = owner => sql(target, `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL recovery.owner='${owner}'; SELECT count(*) FROM public.records; ROLLBACK;`).split('\n').filter(v=>/^\d+$/.test(v)).join();
 assert.equal(visible('owner-a'),'1'); assert.equal(visible('stranger'),'0');
 assert.equal(sql(target,"SELECT relrowsecurity FROM pg_class WHERE oid='public.records'::regclass"),'t');
 console.log('PASS: synthetic DB archive restored to separate DB; rows, SELECT grant and owner RLS verified');
} finally {
 if(targetCreated)sql('postgres',`DROP DATABASE ${target}`);
 if(sourceCreated)sql('postgres',`DROP DATABASE ${source}`);
}
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(key,'Local service key required');
const db=createClient('http://127.0.0.1:54321',key,{auth:{persistSession:false,autoRefreshToken:false}});
const bucket=`recovery-${suffix}`, path='dummy.png';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=','base64');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=result=>{if(result.error)throw Error('Local Storage rehearsal operation failed: '+result.error.message);return result.data;};
let bucketCreated=false;
try {
 check(await db.storage.createBucket(bucket,{public:false})); bucketCreated=true;
 check(await db.storage.from(bucket).upload(path,png,{contentType:'image/png'}));
 const backup=Buffer.from(await check(await db.storage.from(bucket).download(path)).arrayBuffer());
 assert.equal(hash(backup),hash(png));
 check(await db.storage.from(bucket).remove([path]));
 assert.ok((await db.storage.from(bucket).download(path)).error,'Object must be absent before restore');
 check(await db.storage.from(bucket).upload(path,backup,{contentType:'image/png'}));
 const restored=Buffer.from(await check(await db.storage.from(bucket).download(path)).arrayBuffer());
 assert.equal(hash(restored),hash(backup)); assert.equal(restored.length,backup.length);
 const config=check(await db.storage.getBucket(bucket)); assert.equal(config.public,false);
 const response=await fetch(`http://127.0.0.1:54321/storage/v1/object/public/${bucket}/${path}`);
 assert.ok(!response.ok,'Restored object must remain inaccessible through public URL');
 console.log('PASS: dummy Storage bytes downloaded, deleted, restored, SHA256 checked; bucket remains private');
} finally {
 if(bucketCreated){check(await db.storage.emptyBucket(bucket));check(await db.storage.deleteBucket(bucket));}
}
