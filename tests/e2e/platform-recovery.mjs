// Synthetic CI only. Exercises the actual exporter and ordinary postgres role.
// A passing local rehearsal is NOT proof of hosted restore permissions/config.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SRC='supabase_db_lino-e2e', DST='supabase_db_lino-recovery-target';
const sourceURL='http://127.0.0.1:54321', targetURL='http://127.0.0.1:54331';
const cleanEnv=Object.fromEntries(['PATH','HOME','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const run=(cmd,args,options={})=>{
 try{return execFileSync(cmd,args,{env:cleanEnv,stdio:['pipe','pipe','pipe'],maxBuffer:64*1024*1024,timeout:300000,...options});}
 catch(error){
  if(cmd==='docker' && args.includes('psql')){
   const lines=String(error.stderr??'').split('\n').filter(line=>/\bERROR:/.test(line)&&!/(?:password|token|secret|COPY|DETAIL:)/i.test(line));
   for(const line of lines.slice(0,3))console.error(line.slice(0,250));
  }
  throw Error('synthetic local subprocess failed');
 }
};
const sql=(container,query)=>{
 assert.ok([SRC,DST].includes(container));
 return run('docker',['exec','-i',container,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:query}).toString().trim();
};
const status=workdir=>JSON.parse(run('npx',['--no-install','supabase','status','--workdir',workdir,'--output','json']).toString());
const check=result=>{if(result.error)throw Error('synthetic API check failed');return result.data;};
const compareCatalog=(actual,expected,label)=>{
 const a=JSON.parse(actual),b=JSON.parse(expected);
 let mismatch=false;
 for(const section of Object.keys(b)){
  if(JSON.stringify(a[section])!==JSON.stringify(b[section])){
   mismatch=true;
   // Catalog metadata only: no user/Auth rows, tokens, passwords or SQL dumps.
   const actualRows=a[section]??[],expectedRows=b[section]??[];
   const at=Array.from({length:Math.max(actualRows.length,expectedRows.length)},(_,i)=>i)
    .find(i=>JSON.stringify(actualRows[i])!==JSON.stringify(expectedRows[i]))??0;
   const actualRow=actualRows[at]??{},expectedRow=expectedRows[at]??{};
   const fields=[...new Set([...Object.keys(actualRow),...Object.keys(expectedRow)])]
    .filter(key=>JSON.stringify(actualRow[key])!==JSON.stringify(expectedRow[key]));
   const identity=Object.fromEntries(['schema','table_schema','schemaname','table_name','tablename','name','column_name','policyname','indexname']
    .filter(key=>expectedRow[key]!==undefined).map(key=>[key,String(expectedRow[key]).slice(0,120)]));
   const changes=fields.slice(0,3).map(field=>({field,expected:JSON.stringify(expectedRow[field])?.slice(0,700),actual:JSON.stringify(actualRow[field])?.slice(0,700)}));
   console.error('Schema-only difference: '+JSON.stringify({label,section,entry:at,identity,expectedCount:expectedRows.length,actualCount:actualRows.length,changes}));
  }
 }
 if(mismatch)throw Error('catalog mismatch');
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Transport adaptation only: SQL statements and data are never rewritten.
const sqlOnly=bytes=>{
 const lines=bytes.toString('utf8').split('\n');let restriction=null;
 return lines.filter(line=>{
  if(!line.trimStart().startsWith('\\'))return true;
  const match=/^\\(restrict|unrestrict) ([A-Za-z0-9]+)\s*$/.exec(line);
  assert.ok(match,'Unexpected psql meta-command');
  if(match[1]==='restrict'){assert.equal(restriction,null);restriction=match[2];}
  else{assert.equal(match[2],restriction);restriction=null;}
  return false;
 }).join('\n')+(()=>{assert.equal(restriction,null);return '';})();
};
const assertSyntheticRows=users=>{
 // Fixed local container, never a remote URL. Remove only synthetic admin audit.
 sql(SRC,'DELETE FROM auth.audit_log_entries;');
 const tables=JSON.parse(sql(SRC,"SELECT json_agg(json_build_object('schema',schemaname,'name',tablename)) FROM pg_tables WHERE schemaname IN ('public','auth','storage')"));
 const expected={'public.stylists':2,'public.customers':1,'public.stylist_customers':1,'public.medical_records':1,'auth.users':2,'auth.identities':2,'storage.buckets':1};
 for(const {schema,name} of tables){
  assert.match(schema,/^[a-z_]+$/);assert.match(name,/^[a-z_0-9]+$/);
  if(['auth.schema_migrations','storage.migrations'].includes(schema+'.'+name))continue;
  assert.equal(Number(sql(SRC,`SELECT count(*) FROM "${schema}"."${name}"`)),expected[schema+'.'+name]??0,'Unexpected synthetic fixture table count: '+schema+'.'+name);
 }
 assert.deepEqual(JSON.parse(sql(SRC,'SELECT json_agg(id ORDER BY id) FROM auth.users')),users.map(u=>u.id).sort());
 assert.deepEqual(JSON.parse(sql(SRC,'SELECT json_agg(user_id ORDER BY user_id) FROM auth.identities')),users.map(u=>u.id).sort());
};
const options={auth:{persistSession:false,autoRefreshToken:false}};
let stage='guards';
const progress=value=>{stage=value;console.log(value);};
// Definitions only; no auth rows or secrets are included in this comparison.
const catalog=schemas=>`SELECT json_build_object(
 'default_privileges',(SELECT json_agg(t ORDER BY schema,owner,object_type) FROM (SELECT n.nspname AS schema,pg_get_userbyid(d.defaclrole) AS owner,d.defaclobjtype AS object_type,(SELECT array_agg(a::text ORDER BY a::text) FROM unnest(d.defaclacl) a) AS acl FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname IN (${schemas})) t),
 'tables',(SELECT json_agg(t ORDER BY schema,name) FROM (SELECT n.nspname AS schema,c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner,(SELECT array_agg(a::text ORDER BY a::text) FROM unnest(c.relacl) a) AS acl FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname IN (${schemas}) AND c.relkind IN ('r','p','v','m','S')) t),
 'columns',(SELECT json_agg(t ORDER BY table_schema,table_name,ordinal_position) FROM (SELECT table_schema,table_name,column_name,row_number() OVER (PARTITION BY table_schema,table_name ORDER BY ordinal_position) AS ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema IN (${schemas})) t),
 'indexes',(SELECT json_agg(t ORDER BY schemaname,tablename,indexname) FROM (SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN (${schemas})) t),
 'policies',(SELECT json_agg(t ORDER BY schemaname,tablename,policyname) FROM (SELECT * FROM pg_policies WHERE schemaname IN (${schemas})) t),
 'constraints',(SELECT json_agg(t ORDER BY schema,table_name,name) FROM (SELECT n.nspname AS schema,c.relname AS table_name,k.conname AS name,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON k.conrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname IN (${schemas})) t),
 'functions',(SELECT json_agg(t ORDER BY schema,name,args) FROM (SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS args,pg_get_functiondef(p.oid) AS definition,pg_get_userbyid(p.proowner) AS owner,(SELECT array_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) a) AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN (${schemas}) AND p.prokind IN ('f','p')) t),
 'triggers',(SELECT json_agg(t ORDER BY schema,table_name,name) FROM (SELECT n.nspname AS schema,c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN (${schemas}) AND NOT t.tgisinternal) t)
)::text;`;

async function main(){
 assert.equal(process.env.CI,'true');assert.equal(process.env.LINO_E2E_LOCAL,'1');
 assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,sourceURL);
 const ss=status('tests/e2e'),ts=status('tests/e2e/recovery-target');
 assert.equal(ss.API_URL,sourceURL);assert.equal(ts.API_URL,targetURL);
 assert.equal(new URL(ss.DB_URL).hostname,'127.0.0.1');assert.equal(new URL(ss.DB_URL).port,'54322');
 for(const container of [SRC,DST]){
  assert.equal(sql(container,"SELECT current_user='postgres' AND NOT rolsuper FROM pg_roles WHERE rolname=current_user"),'t');
  assert.equal(sql(container,'SELECT count(*) FROM auth.users'),'0');
  assert.equal(sql(container,'SELECT count(*) FROM storage.objects'),'0');
 }
 assert.equal(sql(SRC,'SELECT count(*) FROM public.stylists'),'0');
 assert.equal(sql(DST,"SELECT count(*) FROM pg_tables WHERE schemaname='public'"),'0');
 const source=createClient(sourceURL,ss.SERVICE_ROLE_KEY,options);
 const target=createClient(targetURL,ts.SERVICE_ROLE_KEY,options);
 const folder=mkdtempSync(join(tmpdir(),'lino-platform-'));chmodSync(folder,0o700);
 const users=[], customer=randomUUID(),record=randomUUID();
 const services=['auth','rest','storage'].map(name=>'supabase_'+name+'_lino-recovery-target');
 let stopped=false;
 try{
  progress('Platform candidate: seed synthetic identities and LiNo ownership');
  for(const label of ['owner','stranger']){
   const email=`platform-${randomUUID()}@example.test`,password=randomUUID()+randomUUID();
   const user=check(await source.auth.admin.createUser({email,password,email_confirm:true})).user;
   assert.ok(user);users.push({id:user.id,email,password});
   check(await source.from('stylists').insert({id:user.id,name:`Synthetic ${label}`}));
  }
  check(await source.from('customers').insert({id:customer,line_user_id:`manual:platform:${customer}`,display_name:'Synthetic candidate recovery'}));
  check(await source.from('stylist_customers').insert({stylist_id:users[0].id,customer_id:customer}));
  check(await source.from('medical_records').insert({id:record,customer_id:customer,stylist_id:users[0].id,visit_date:'2026-01-01',notes:'Synthetic candidate record'}));
  assertSyntheticRows(users);
  const publicBefore=sql(SRC,catalog("'public'"));
  const managedBefore=sql(DST,catalog("'auth','storage'"));
  // This fixture has no custom managed definitions; prove it against target.
  assert.equal(sql(SRC,catalog("'auth','storage'")),managedBefore);
  progress('Platform candidate: run production export module into private temporary package');
  const srcDb=new URL(ss.DB_URL);
  run('python3',['scripts/backup/platform_export.py',join(folder,'database.tar')],{env:{...cleanEnv,
   CI:'true',LINO_E2E_LOCAL:'1',NEXT_PUBLIC_SUPABASE_URL:sourceURL,
   PGHOST:'127.0.0.1',PGPORT:'54322',PGUSER:'postgres',PGDATABASE:'postgres',
   PGPASSWORD:decodeURIComponent(srcDb.password),PGSSLMODE:'disable',LINO_BACKUP_MAX_BYTES:'67108864',LINO_BACKUP_DATA_MODE:'inserts'}});
  run('tar',['-xf',join(folder,'database.tar'),'-C',folder]);
  const report=JSON.parse(readFileSync(join(folder,'package.json'),'utf8'));
  assert.equal(report.database_format,'supabase-cli-platform-v1');assert.equal(report.data_mode,'inserts');
  assert.equal(report.hosted_restore_verified,false);assert.ok(report.restore_gates.length>=5);
  const files={};
  for(const [name,metadata] of Object.entries(report.files)){
   assert.ok(['roles.sql','pre_restore.sql','schema.sql','data.sql','history_schema.sql','history_data.sql'].includes(name));
   files[name]=readFileSync(join(folder,name));
   assert.equal(files[name].length,metadata.bytes);assert.equal(hash(files[name]),metadata.sha256);
  }
  for(const name of ['roles.sql','pre_restore.sql','schema.sql','data.sql'])assert.ok(files[name]);
  // Remove only psql restrict framing; never change SQL, suppress errors or use an admin role.
  assert.ok(!/^COPY\s/im.test(files['data.sql'].toString('utf8')));
  assert.match(files['data.sql'].toString('utf8'),/^INSERT INTO /m);
  progress('Platform candidate: restore filtered roles/schema/data with ordinary postgres');
  stopped=true;run('docker',['stop',...services]);
  assert.deepEqual(report.restore_order.slice(0,3),['roles.sql','pre_restore.sql','schema.sql']);
  const chunks=[files['roles.sql'],files['pre_restore.sql'],files['schema.sql']];
  if(files['history_schema.sql'])chunks.push(files['history_schema.sql']);
  chunks.push(Buffer.from('SET session_replication_role = replica;\n'),files['data.sql']);
  if(files['history_data.sql'])chunks.push(files['history_data.sql']);
  const restoreSQL=chunks.map(sqlOnly).join('\n');
  run('docker',['exec','-i',DST,'psql','-X','--single-transaction','-f','-','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:restoreSQL});
  compareCatalog(sql(DST,catalog("'auth','storage'")),managedBefore,'managed auth/storage');
  compareCatalog(sql(DST,catalog("'public'")),publicBefore,'public');
  if(report.migration_history==='included'){
   const history="SELECT COALESCE(json_agg(t ORDER BY version)::text,'[]') FROM supabase_migrations.schema_migrations t";
   assert.equal(sql(DST,history),sql(SRC,history));
  }
  run('docker',['start',...services]);stopped=false;
  let ready=false;
  for(let i=0;i<60;i++){
   try{
    const authHealth=await fetch(targetURL+'/auth/v1/health',{headers:{apikey:ts.ANON_KEY}});
    if(authHealth.ok && !(await target.from('stylists').select('id')).error){ready=true;break;}
   }catch{}
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.ok(ready);
  progress('Platform candidate: verify same-password login and public owner isolation');
  const clients=[];
  for(const user of users){
   const client=createClient(targetURL,ts.ANON_KEY,options);
   const login=check(await client.auth.signInWithPassword({email:user.email,password:user.password}));
   assert.equal(login.user.id,user.id);clients.push(client);
  }
  for(const [table,id] of [['customers',customer],['medical_records',record]]){
   assert.equal(check(await clients[0].from(table).select('id').eq('id',id)).length,1);
   assert.equal(check(await clients[1].from(table).select('id').eq('id',id)).length,0);
  }
  const anonymous=createClient(targetURL,ts.ANON_KEY,options);
  const response=await anonymous.from('medical_records').select('id').eq('id',record);
  assert.ok(response.error || response.data.length===0);
  for(const client of clients)check(await client.auth.signOut());
  // Explicit synthetic artifact for a subsequent hosted rehearsal. No hosted keys.
  const artifact='/tmp/lino-hosted-fixture';
  const outputs={...files,'package.json':Buffer.from(JSON.stringify(report)),
   'restore.sql':Buffer.from(restoreSQL),'expected-public.json':Buffer.from(publicBefore),
   'expected-managed.json':Buffer.from(managedBefore),
   'fixture.json':Buffer.from(JSON.stringify({format:'lino-synthetic-hosted-fixture-v1',synthetic_only:true,
    hosted_restore_verified:false,source:'fixed-local-CI',users,customer,record,
    transport:'CLI inserts; only paired psql restrict/unrestrict framing removed',
    limitations:['No photo bytes in this fixture','No custom managed definitions','No hosted configuration equivalence claim']}))};
  assert.ok(Object.values(outputs).reduce((sum,b)=>sum+b.length,0)<8*1024*1024);
  mkdirSync(artifact,{mode:0o700});
  try{
   for(const [name,bytes] of Object.entries(outputs))writeFileSync(join(artifact,name),bytes,{mode:0o600,flag:'wx'});
   writeFileSync(join(artifact,'checksums.json'),JSON.stringify(Object.fromEntries(Object.entries(outputs).map(([name,b])=>[name,{bytes:b.length,sha256:hash(b)}]))),{mode:0o600,flag:'wx'});
  }catch(error){rmSync(artifact,{recursive:true,force:true});throw error;}
  console.log('PASS: actual filtered export restored locally as non-superuser postgres; managed definitions unchanged, password login and public RLS verified. Hosted gates remain unresolved.');
 }finally{
  // Every plaintext file is removed even when restore or assertions fail.
  rmSync(folder,{recursive:true,force:true});
  if(stopped)run('docker',['start',...services]);
  check(await source.from('medical_records').delete().eq('id',record));
  check(await source.from('stylist_customers').delete().eq('customer_id',customer));
  check(await source.from('customers').delete().eq('id',customer));
  for(const user of users){
   check(await source.from('stylists').delete().eq('id',user.id));
   check(await source.auth.admin.deleteUser(user.id));
  }
  assert.equal(sql(SRC,'SELECT count(*) FROM auth.users'),'0');
 }
}
main().catch(()=>{console.error('Platform candidate local recovery FAILED at '+stage+'; diagnostics withheld to protect database contents.');process.exitCode=1;});
