// Disposable local-only LiNo recovery. Never a hosted production restore tool.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SRC='supabase_db_lino-e2e', DST='supabase_db_lino-recovery-target';
const sourceURL='http://127.0.0.1:54321', targetURL='http://127.0.0.1:54331';
const cleanEnv=Object.fromEntries(['PATH','HOME','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const run=(cmd,args,extra={})=>{
 try{return execFileSync(cmd,args,{env:cleanEnv,stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024,timeout:120000,...extra});}
 catch(error){
  // Database tools operate on synthetic local data; retain only PostgreSQL ERROR
  // lines, never COPY rows, Auth values, status JSON, stdout or credentials.
  if(cmd==='docker'&&args.some(x=>['psql','pg_dump','pg_restore'].includes(x))){
   const lines=String(error.stderr??'').split('\n').filter(line=>/\bERROR:/.test(line)&&!/(?:password|token|secret|COPY|DETAIL:)/i.test(line));
   for(const line of lines.slice(0,3))console.error(line.slice(0,300));
  }
  throw Error('local subprocess failed');
 }
};
const sql=(container,query)=>{
 assert.ok([SRC,DST].includes(container));
 return run('docker',['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-At','-U','postgres','-d','postgres'],{input:query}).toString().trim();
};
const status=workdir=>JSON.parse(run('npx',['--no-install','supabase','status','--workdir',workdir,'--output','json']).toString());
const check=r=>{if(r.error)throw Error('local API operation failed');return r.data;};
const hash=b=>createHash('sha256').update(b).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=','base64');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const services=['auth','rest','storage'].map(x=>'supabase_'+x+'_lino-recovery-target');
const catalog=schemas=>`SELECT json_build_object(
 'columns',(SELECT json_agg(t ORDER BY table_schema,table_name,ordinal_position) FROM (SELECT table_schema,table_name,column_name,ordinal_position,data_type,udt_schema,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema IN (${schemas})) t),
 'relations',(SELECT json_agg(t ORDER BY schema,name) FROM (SELECT n.nspname AS schema,c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN (${schemas}) AND c.relkind IN ('r','p','v','m','S')) t),
 'constraints',(SELECT json_agg(t ORDER BY schema,table_name,name) FROM (SELECT n.nspname AS schema,c.relname AS table_name,con.conname AS name,con.convalidated,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN (${schemas})) t),
 'indexes',(SELECT json_agg(t ORDER BY schemaname,tablename,indexname) FROM (SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN (${schemas})) t),
 'policies',(SELECT json_agg(t ORDER BY schemaname,tablename,policyname) FROM (SELECT * FROM pg_policies WHERE schemaname IN (${schemas})) t),
 'functions',(SELECT json_agg(t ORDER BY schema,name,args) FROM (SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS args,pg_get_functiondef(p.oid) AS definition,p.proacl::text,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN (${schemas}) AND p.prokind IN ('f','p')) t)
)::text;`;

async function main(){
 assert.equal(process.env.CI,'true'); assert.equal(process.env.LINO_E2E_LOCAL,'1');
 assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,sourceURL);
 const sourceStatus=status('tests/e2e'),targetStatus=status('tests/e2e/recovery-target');
 assert.equal(sourceStatus.API_URL,sourceURL); assert.equal(targetStatus.API_URL,targetURL);
 assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY,sourceStatus.SERVICE_ROLE_KEY);
 assert.equal(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,sourceStatus.ANON_KEY);
 assert.equal(sql(SRC,'SELECT count(*) FROM auth.users'),'0','fresh source Auth required');
 assert.equal(sql(SRC,'SELECT count(*) FROM public.stylists'),'0','fresh source LiNo required');
 assert.equal(sql(DST,'SELECT count(*) FROM auth.users'),'0','fresh target Auth required');
 assert.equal(sql(DST,'SELECT count(*) FROM storage.objects'),'0','fresh target Storage required');
 const source=createClient(sourceURL,sourceStatus.SERVICE_ROLE_KEY,options);
 const target=createClient(targetURL,targetStatus.SERVICE_ROLE_KEY,options);
 const users=[], customer=randomUUID(),record=randomUUID(),photo=randomUUID();
 const path=`recovery-${randomUUID()}/synthetic.png`;
 let customerCreated=false,sourcePhoto=false,targetPhoto=false,targetStopped=false;
 try{
  console.log('LiNo recovery: seed synthetic Auth, billing, customer, record and photo');
  for(const label of ['owner','stranger']){
   const email=`lino-recovery-${randomUUID()}@example.test`,password=randomUUID()+randomUUID();
   const user=check(await source.auth.admin.createUser({email,password,email_confirm:true})).user;
   assert.ok(user); users.push({id:user.id,email,password});
   check(await source.from('stylists').insert({id:user.id,name:`Synthetic ${label}`}));
   check(await source.from('billing_accounts').insert({stylist_id:user.id,is_master:false,stripe_status:'trialing',trial_started_at:new Date().toISOString(),period_end:new Date(Date.now()+14*86400000).toISOString()}));
  }
  check(await source.from('customers').insert({id:customer,line_user_id:`manual:recovery:${customer}`,display_name:'Synthetic recovery customer'})); customerCreated=true;
  check(await source.from('stylist_customers').insert({stylist_id:users[0].id,customer_id:customer}));
  check(await source.from('medical_records').insert({id:record,customer_id:customer,stylist_id:users[0].id,visit_date:'2026-01-01',notes:'Synthetic recovery record'}));
  const existing=await source.storage.getBucket('record-photos');
  if(existing.error)check(await source.storage.createBucket('record-photos',{public:false,fileSizeLimit:10485760,allowedMimeTypes:['image/png','image/jpeg','image/webp']}));
  assert.equal(check(await source.storage.getBucket('record-photos')).public,false);
  check(await source.storage.from('record-photos').upload(path,png,{contentType:'image/png'})); sourcePhoto=true;
  check(await source.from('record_photos').insert({id:photo,record_id:record,storage_path:path}));
  const backupPhoto=Buffer.from(await check(await source.storage.from('record-photos').download(path)).arrayBuffer());
  assert.equal(hash(backupPhoto),hash(png));
  const beforeCatalog=sql(SRC,catalog("'public','auth'"));
  const managedStorage=sql(DST,catalog("'storage'"));
  console.log('LiNo recovery: dump actual local public + auth schemas and restore independent target');
  const archive=run('docker',['exec',SRC,'pg_dump','-U','postgres','-d','postgres','-Fc','--schema=public','--schema=auth']);
  assert.ok(archive.length>0&&archive.length<32*1024*1024);
  // Fixed disposable target only. Pause services so Auth cannot migrate mid-restore.
  targetStopped=true; run('docker',['stop',...services]);
  sql(DST,'DROP SCHEMA public CASCADE; DROP SCHEMA auth CASCADE;');
  run('docker',['exec','-i',DST,'pg_restore','-U','postgres','-d','postgres','--exit-on-error'],{input:archive});
  assert.deepEqual(JSON.parse(sql(DST,catalog("'public','auth'"))),JSON.parse(beforeCatalog),'schema/RLS/functions/grants must survive');
  assert.deepEqual(JSON.parse(sql(DST,catalog("'storage'"))),JSON.parse(managedStorage),'managed Storage definitions must survive schema replacement');
  run('docker',['start',...services]); targetStopped=false;
  let ready=false;
  for(let i=0;i<60;i++){
   try { const r=await target.from('stylists').select('id');if(!r.error){ready=true;break;} }catch{}
   await new Promise(r=>setTimeout(r,1000));
  }
  assert.ok(ready,'target API readiness');
  console.log('LiNo recovery: authenticate restored identities and verify owner isolation');
  const clients=[];
  for(const user of users){
   const client=createClient(targetURL,targetStatus.ANON_KEY,options);
   const logged=check(await client.auth.signInWithPassword({email:user.email,password:user.password}));
   assert.equal(logged.user.id,user.id); clients.push(client);
  }
  for(const [table,id] of [['customers',customer],['medical_records',record],['record_photos',photo]]){
   assert.equal(check(await clients[0].from(table).select('*').eq('id',id)).length,1);
   assert.equal(check(await clients[1].from(table).select('*').eq('id',id)).length,0);
  }
  const billing=check(await target.from('billing_accounts').select('is_master,stripe_status').eq('stylist_id',users[0].id).single());
  assert.equal(billing.is_master,false);assert.equal(billing.stripe_status,'trialing');
  const restoredRecord=check(await target.from('medical_records').select('customer_id,stylist_id').eq('id',record).single());
  assert.equal(restoredRecord.customer_id,customer);assert.equal(restoredRecord.stylist_id,users[0].id);
  console.log('LiNo recovery: restore photo bytes through target Storage API');
  check(await target.storage.createBucket('record-photos',{public:false,fileSizeLimit:10485760,allowedMimeTypes:['image/png','image/jpeg','image/webp']}));
  check(await target.storage.from('record-photos').upload(path,backupPhoto,{contentType:'image/png'})); targetPhoto=true;
  const restored=Buffer.from(await check(await target.storage.from('record-photos').download(path)).arrayBuffer());
  assert.equal(hash(restored),hash(backupPhoto));
  const reference=check(await target.from('record_photos').select('record_id,storage_path').eq('id',photo).single());
  assert.equal(reference.record_id,record);assert.equal(reference.storage_path,path);
  assert.equal(check(await target.storage.getBucket('record-photos')).public,false);
  assert.ok(!(await fetch(`${targetURL}/storage/v1/object/public/record-photos/${path}`)).ok);
  // Current LiNo photo model is server-only, including the record owner.
  assert.ok((await clients[0].storage.from('record-photos').download(path)).error);
  assert.ok((await clients[1].storage.from('record-photos').download(path)).error);
  for(const client of clients)check(await client.auth.signOut());
  console.log('PASS: independent local LiNo DB/Auth/Storage recovery; real login, ownership, catalog, byte hashes and privacy verified');
 }finally{
  console.log('LiNo recovery: remove synthetic source fixtures and uploaded objects');
  let cleanupFailed=false;
  const cleanup=async fn=>{try{await fn();}catch{cleanupFailed=true;}};
  if(targetStopped)await cleanup(async()=>run('docker',['start',...services]));
  if(targetPhoto)await cleanup(async()=>check(await target.storage.from('record-photos').remove([path])));
  if(sourcePhoto)await cleanup(async()=>check(await source.storage.from('record-photos').remove([path])));
  await cleanup(async()=>check(await source.from('record_photos').delete().eq('id',photo)));
  await cleanup(async()=>check(await source.from('medical_records').delete().eq('id',record)));
  if(customerCreated){
   await cleanup(async()=>check(await source.from('stylist_customers').delete().eq('customer_id',customer)));
   await cleanup(async()=>check(await source.from('customers').delete().eq('id',customer)));
  }
  for(const user of users){
   await cleanup(async()=>check(await source.from('billing_accounts').delete().eq('stylist_id',user.id)));
   await cleanup(async()=>check(await source.from('stylists').delete().eq('id',user.id)));
   await cleanup(async()=>check(await source.auth.admin.deleteUser(user.id)));
  }
  assert.equal(cleanupFailed,false,'synthetic cleanup must succeed');
  assert.equal(sql(SRC,'SELECT count(*) FROM auth.users'),'0');
  assert.equal(check(await source.from('record_photos').select('id').eq('id',photo)).length,0);
  if(sourcePhoto)assert.ok((await source.storage.from('record-photos').download(path)).error);
  if(targetPhoto)assert.ok((await target.storage.from('record-photos').download(path)).error);
 }
}
main().catch(()=>{console.error('LiNo local recovery FAILED; see last named stage. No hosted endpoint used.');process.exitCode=1;});
