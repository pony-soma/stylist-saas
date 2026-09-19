// Fixed disposable CI source only. Never accepts hosted connection settings.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { acquireCaptureLock } from '../../scripts/backup/capture-lock.mjs';

assert.equal(process.env.CI,'true');
assert.equal(process.env.LINO_E2E_LOCAL,'1');
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54321');
const info=JSON.parse(execFileSync('npx',['--no-install','supabase','status','--workdir','tests/e2e','-o','json'],
  {encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(info.API_URL,'http://127.0.0.1:54321');
assert.equal(new URL(info.DB_URL).hostname,'127.0.0.1');
assert.equal(new URL(info.DB_URL).port,'54322');
const options={auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(45000)})}};
const admin=createClient(info.API_URL,info.SERVICE_ROLE_KEY,options);
const anon=createClient(info.API_URL,info.ANON_KEY,options);
const client=new pg.Client({connectionString:info.DB_URL,connectionTimeoutMillis:5000});
const observer=new pg.Client({connectionString:info.DB_URL,connectionTimeoutMillis:5000});
// Prevent disconnect events from dumping details into CI output.
client.on('error',()=>{});observer.on('error',()=>{});
const check=result=>{assert.equal(result.error,null,'Synthetic API operation failed');return result.data;};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const path='capture-lock/'+randomUUID()+'.png';
const signedPath='capture-lock/'+randomUUID()+'.png';
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const email='capture-'+randomUUID()+'@example.test',password=randomUUID()+randomUUID();
const tusHeaders={'authorization':'Bearer '+info.SERVICE_ROLE_KEY,'apikey':info.SERVICE_ROLE_KEY,
  'Tus-Resumable':'1.0.0','x-upsert':'true'};
const tusRequest=(url,init)=>fetch(url,{...init,headers:{...tusHeaders,...init.headers},
  redirect:'error',signal:AbortSignal.timeout(45000)});
async function startTus(objectName,first,total){
  const metadata=Object.entries({bucketName:'record-photos',objectName,contentType:'image/png',cacheControl:'0'})
    .map(([key,value])=>key+' '+Buffer.from(value).toString('base64')).join(',');
  const response=await tusRequest(info.API_URL+'/storage/v1/upload/resumable',{
    method:'POST',headers:{'Upload-Length':String(total),'Upload-Metadata':metadata,
      'Content-Type':'application/offset+octet-stream'},body:first});
  assert.equal(response.status,201,'TUS creation must work before locking');
  assert.equal(response.headers.get('upload-offset'),String(first.length));
  const location=new URL(response.headers.get('location'),info.API_URL);
  assert.equal(location.origin,info.API_URL);assert.ok(location.pathname.startsWith('/storage/v1/upload/resumable/'));
  await response.arrayBuffer();return location.href;
}
let lock, account, stage='connect';
try {
  await client.connect();await observer.connect();
  const {rows:[identity]}=await client.query('select pg_backend_pid() as pid');
  account=check(await admin.auth.admin.createUser({email,password,email_confirm:true})).user;
  check(await admin.from('stylists').insert({id:account.id,name:'capture fixture'}));
  check(await admin.storage.from('record-photos').upload(path,bytes,{contentType:'image/png'}));
  const signed=check(await admin.storage.from('record-photos').createSignedUploadUrl(signedPath));
  check(await anon.auth.signInWithPassword({email,password}));
  check(await anon.storage.from('record-photos').uploadToSignedUrl(signedPath,signed.token,bytes,{contentType:'image/png'}));
  check(await admin.storage.from('record-photos').remove([signedPath]));
  // Prove this TUS client works, then admit a partial overwrite before closure.
  stage='TUS baseline';
  await startTus(signedPath,bytes,bytes.length);
  check(await admin.storage.from('record-photos').remove([signedPath]));
  const partial=Buffer.alloc(6*1024*1024);bytes.copy(partial);
  const pendingTus=await startTus(path,partial,partial.length+bytes.length);
  stage='acquire';lock=await acquireCaptureLock(client);await lock.verify();
  // Reads remain usable while updates from ordinary SQL are refused on timeout.
  await observer.query("set lock_timeout='500ms'");
  await assert.rejects(observer.query('update public.stylists set name=name where id=$1',[account.id]),e=>e.code==='55P03');
  await assert.rejects(observer.query('update auth.users set updated_at=updated_at where id=$1',[account.id]),e=>e.code==='55P03');
  await assert.rejects(observer.query('delete from storage.objects where bucket_id=$1 and name=$2',['record-photos',path]),e=>e.code==='55P03');
  assert.equal(hash(Buffer.from(await check(await admin.storage.from('record-photos').download(path)).arrayBuffer())),hash(bytes));
  stage='concurrent HTTP';
  const results=await Promise.allSettled([
    admin.storage.from('record-photos').upload(path,Buffer.from('changed'),{upsert:true,contentType:'image/png'}),
    admin.storage.from('record-photos').remove([path]),
    anon.storage.from('record-photos').uploadToSignedUrl(signedPath,signed.token,bytes,{contentType:'image/png'}),
    anon.auth.signInWithPassword({email,password}),
    tusRequest(pendingTus,{method:'PATCH',headers:{'Upload-Offset':String(partial.length),
      'Content-Type':'application/offset+octet-stream'},body:bytes}).then(async response=>{
        const ok=response.ok;await response.arrayBuffer();return {error:ok?null:'blocked'};
      }),
  ]);
  for(const [index,result] of results.entries())
    assert.ok(result.status==='rejected'||result.value.error,'Writer unexpectedly succeeded: '+index);
  await lock.verify();
  assert.equal(hash(Buffer.from(await check(await admin.storage.from('record-photos').download(path)).arrayBuffer())),hash(bytes));
  assert.equal((await observer.query('select count(*)::int as count from storage.objects where bucket_id=$1 and name=$2',['record-photos',signedPath])).rows[0].count,0);
  // Client timeout is NOT server cancellation: fail unless queued writers drain.
  stage='drain';
  const deadline=Date.now()+45000;
  while(true){
    const {rows:[row]}=await observer.query('select count(*)::int as waiting from pg_stat_activity where $1=any(pg_blocking_pids(pid))',[identity.pid]);
    if(row.waiting===0)break;
    assert.ok(Date.now()<deadline,'Server writers did not drain');
    await lock.verify();await new Promise(resolve=>setTimeout(resolve,500));
  }
  stage='release';await lock.release();
  await assert.rejects(lock.verify());lock=null;
  check(await anon.auth.signInWithPassword({email,password}));
  check(await admin.storage.from('record-photos').upload(path,bytes,{upsert:true,contentType:'image/png'}));
  console.log('Capture lock rehearsal passed: SQL and HTTP writes blocked, photo reads unchanged, queues drained, normal operation resumed.');
  console.log('Scope: standard/signed upload, pre-admitted partial resumable overwrite, delete, login. S3 uploads, hosted service versions, sequences and cutover remain separate gates.');
} catch {
  console.error('Capture lock rehearsal failed at '+stage+'; no production conclusion.');
  process.exitCode=1;
} finally {
  if(lock)await lock.release().catch(()=>{});
  await client.end().catch(()=>{});await observer.end().catch(()=>{});
  await admin.storage.from('record-photos').remove([path,signedPath]).catch(()=>{});
  if(account)await admin.auth.admin.deleteUser(account.id).catch(()=>{});
}
