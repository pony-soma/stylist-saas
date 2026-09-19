// Fixed disposable CI source only. Never accepts hosted connection settings.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand, DeleteObjectCommand, CreateMultipartUploadCommand,
  UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { acquireCaptureLock } from '../../scripts/backup/capture-lock.mjs';

assert.equal(process.env.CI,'true');
assert.equal(process.env.LINO_E2E_LOCAL,'1');
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54321');
const info=JSON.parse(execFileSync('npx',['--no-install','supabase','status','--workdir','tests/e2e','-o','json'],
  {encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(info.API_URL,'http://127.0.0.1:54321');
assert.equal(new URL(info.DB_URL).hostname,'127.0.0.1');
assert.equal(new URL(info.DB_URL).port,'54322');
// These are generated credentials from this exact disposable local container.
const storageContainer=JSON.parse(execFileSync('docker',['inspect','supabase_storage_lino-e2e'],
  {encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0];
const storageEnv=Object.fromEntries(storageContainer.Config.Env.map(entry=>{
  const at=entry.indexOf('=');return [entry.slice(0,at),entry.slice(at+1)];
}));
for(const name of ['S3_PROTOCOL_ACCESS_KEY_ID','S3_PROTOCOL_ACCESS_KEY_SECRET'])
  assert.ok(storageEnv[name],'Local S3 configuration missing: '+name);
// Mirror Storage's SERVER_REGION / legacy REGION / default resolution.
const region=storageEnv.SERVER_REGION||storageEnv.REGION||'not-specified';
const s3=new S3Client({endpoint:info.API_URL+'/storage/v1/s3',region,
  forcePathStyle:true,maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',
  credentials:{accessKeyId:storageEnv.S3_PROTOCOL_ACCESS_KEY_ID,secretAccessKey:storageEnv.S3_PROTOCOL_ACCESS_KEY_SECRET}});
const s3Send=command=>s3.send(command,{abortSignal:AbortSignal.timeout(45000)});
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
let lock, account, multipart, stage='connect';
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
  stage='S3 baseline';
  await s3Send(new PutObjectCommand({Bucket:'record-photos',Key:signedPath,Body:bytes,ContentType:'image/png'}));
  stage='S3 baseline delete';
  await s3Send(new DeleteObjectCommand({Bucket:'record-photos',Key:signedPath}));
  stage='S3 multipart create';
  multipart=await s3Send(new CreateMultipartUploadCommand({Bucket:'record-photos',Key:path,ContentType:'image/png'}));
  assert.ok(multipart.UploadId);
  stage='S3 multipart part';
  const part=await s3Send(new UploadPartCommand({Bucket:'record-photos',Key:path,UploadId:multipart.UploadId,PartNumber:1,Body:bytes}));
  assert.ok(part.ETag);
  stage='existing writer';
  await observer.query('begin');
  await observer.query('update public.stylists set name=name where id=$1',[account.id]);
  await assert.rejects(acquireCaptureLock(client));
  assert.equal((await client.query("select count(*)::int as held from pg_locks where pid=pg_backend_pid() and granted and mode='ShareLock'")).rows[0].held,0);
  await observer.query('rollback');
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
    s3Send(new PutObjectCommand({Bucket:'record-photos',Key:path,Body:bytes,ContentType:'image/png'})).then(()=>({error:null})),
    s3Send(new DeleteObjectCommand({Bucket:'record-photos',Key:path})).then(()=>({error:null})),
    s3Send(new CompleteMultipartUploadCommand({Bucket:'record-photos',Key:path,UploadId:multipart.UploadId,
      MultipartUpload:{Parts:[{PartNumber:1,ETag:part.ETag}]}})).then(()=>({error:null})),
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
  console.log('Scope: standard/signed/S3 writes, pre-admitted TUS and S3 multipart completion, delete, login. Hosted service versions, sequences and cutover remain separate gates.');
} catch (error) {
  console.error('Capture lock rehearsal failed at '+stage+'; no production conclusion.');
  // Only bounded machine identifiers; never log request headers, body or URLs.
  const errorName=String(error?.name||'Unknown');
  console.error('Failure type: '+(/^[A-Za-z0-9_]{1,80}$/.test(errorName)?errorName:'redacted')
    +'; HTTP status: '+(Number.isInteger(error?.$metadata?.httpStatusCode)?error.$metadata.httpStatusCode:'none'));
  process.exitCode=1;
} finally {
  if(lock)await lock.release().catch(()=>{});
  await observer.query('rollback').catch(()=>{});
  await client.end().catch(()=>{});await observer.end().catch(()=>{});
  if(multipart?.UploadId)await s3Send(new AbortMultipartUploadCommand({Bucket:'record-photos',Key:path,UploadId:multipart.UploadId})).catch(()=>{});
  s3.destroy();
  await admin.storage.from('record-photos').remove([path,signedPath]).catch(()=>{});
  if(account)await admin.auth.admin.deleteUser(account.id).catch(()=>{});
}

