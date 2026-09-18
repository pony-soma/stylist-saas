// Synthetic CI only. Exercises the actual exporter and ordinary postgres role.
// A passing local rehearsal is NOT proof of hosted restore permissions/config.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
 for(const section of Object.keys(b)){
  if(JSON.stringify(a[section])!==JSON.stringify(b[section])){
   console.error('Catalog mismatch: '+label+' '+section);
   throw Error('catalog mismatch');
  }
 }
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const options={auth:{persistSession:false,autoRefreshToken:false}};
let stage='guards';
const progress=value=>{stage=value;console.log(value);};
// Definitions only; no auth rows or secrets are included in this comparison.
const catalog=schemas=>`SELECT json_build_object(
 'tables',(SELECT json_agg(t ORDER BY schema,name) FROM (SELECT n.nspname AS schema,c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner,(SELECT array_agg(a::text ORDER BY a::text) FROM unnest(c.relacl) a) AS acl FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname IN (${schemas}) AND c.relkind IN ('r','p','v','m','S')) t),
 'columns',(SELECT json_agg(t ORDER BY table_schema,table_name,ordinal_position) FROM (SELECT table_schema,table_name,column_name,row_number() OVER (PARTITION BY table_schema,table_name ORDER BY ordinal_position) AS ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema IN (${schemas})) t),
 'policies',(SELECT json_agg(t ORDER BY schemaname,tablename,policyname) FROM (SELECT * FROM pg_policies WHERE schemaname IN (${schemas})) t),
 'constraints',(SELECT json_agg(t ORDER BY schema,table_name,name) FROM (SELECT n.nspname AS schema,c.relname AS table_name,k.conname AS name,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON k.conrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname IN (${schemas})) t),
 'functions',(SELECT json_agg(t ORDER BY schema,name,args) FROM (SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS args,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN (${schemas}) AND p.prokind IN ('f','p')) t),
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
  const publicBefore=sql(SRC,catalog("'public'"));
  const managedBefore=sql(DST,catalog("'auth','storage'"));
  // This fixture has no custom managed definitions; prove it against target.
  assert.equal(sql(SRC,catalog("'auth','storage'")),managedBefore);
  progress('Platform candidate: run production export module into private temporary package');
  const srcDb=new URL(ss.DB_URL);
  run('python3',['scripts/backup/platform_export.py',join(folder,'database.tar')],{env:{...cleanEnv,
   CI:'true',LINO_E2E_LOCAL:'1',NEXT_PUBLIC_SUPABASE_URL:sourceURL,
   PGHOST:'127.0.0.1',PGPORT:'54322',PGUSER:'postgres',PGDATABASE:'postgres',
   PGPASSWORD:decodeURIComponent(srcDb.password),PGSSLMODE:'disable',LINO_BACKUP_MAX_BYTES:'67108864'}});
  run('tar',['-xf',join(folder,'database.tar'),'-C',folder]);
  const report=JSON.parse(readFileSync(join(folder,'package.json'),'utf8'));
  assert.equal(report.database_format,'supabase-cli-platform-v1');
  assert.equal(report.hosted_restore_verified,false);assert.ok(report.restore_gates.length>=5);
  const files={};
  for(const [name,metadata] of Object.entries(report.files)){
   assert.ok(['roles.sql','schema.sql','data.sql','history_schema.sql','history_data.sql'].includes(name));
   files[name]=readFileSync(join(folder,name));
   assert.equal(files[name].length,metadata.bytes);assert.equal(hash(files[name]),metadata.sha256);
  }
  for(const name of ['roles.sql','schema.sql','data.sql'])assert.ok(files[name]);
  // Never transform SQL, suppress errors, drop managed schemas, or use an admin role.
  progress('Platform candidate: restore filtered roles/schema/data with ordinary postgres');
  stopped=true;run('docker',['stop',...services]);
  const chunks=[files['roles.sql'],files['schema.sql']];
  if(files['history_schema.sql'])chunks.push(files['history_schema.sql']);
  chunks.push(Buffer.from('SET session_replication_role = replica;\n'),files['data.sql']);
  if(files['history_data.sql'])chunks.push(files['history_data.sql']);
  run('docker',['exec','-i',DST,'psql','-X','--single-transaction','-f','-','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:Buffer.concat(chunks.flatMap(chunk=>[chunk,Buffer.from('\n')]))});
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
