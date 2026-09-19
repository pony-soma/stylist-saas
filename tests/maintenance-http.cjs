// Test built Next middleware with maintenance enabled. No service keys needed.
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const origin='http://127.0.0.1:3100';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{env:{...process.env,LINO_MAINTENANCE_MODE:'true'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
(async()=>{
 try {
  let ready=false;
  for(let i=0;i<60;i++){
   if(child.exitCode!==null)throw Error('Maintenance test server exited');
   try {const r=await fetch(origin,{signal:AbortSignal.timeout(1000)});if(r.status===503){ready=true;break;}} catch {}
   await delay(500);
  }
  assert.ok(ready,'Maintenance server must start');
  for(const path of ['/','/login','/billing','/admin/menus','/auth/callback','/liff']){
   const r=await fetch(origin+path);assert.equal(r.status,503,path);assert.match(await r.text(),/ただいまメンテナンス中/);assert.match(r.headers.get('cache-control'),/no-store/);
  }
  for(const path of ['/api/settings','/api/customers','/api/create-checkout-session','/api/billing/portal','/api/webhooks/stripe','/api/webhook/line']){
   const r=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   assert.equal(r.status,503,path);assert.equal(r.headers.get('retry-after'),'300');assert.match((await r.json()).error,/メンテナンス/);
  }
  for(const path of ['/terms','/privacy','/commercial-disclosure']) assert.equal((await fetch(origin+path)).status,200,path);
  console.log('Maintenance HTTP: pages/APIs/webhooks blocked; legal pages readable. PASS');
 } catch(e){console.error(e);process.exitCode=1;}
 finally {child.kill('SIGTERM');}
})();
