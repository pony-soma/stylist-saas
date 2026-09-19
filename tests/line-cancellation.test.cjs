const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const crypto=require('node:crypto');
const id='11111111-1111-4111-8111-111111111111';
const uid='U'+'a'.repeat(32);
function fixture(options={}) {
 const calls=[];
 const db={from(table){const filters={};let update;
  const q={select(){return q},eq(k,v){filters[k]=v;return q},update(v){update=v;return q},async maybeSingle(){
   calls.push({table,filters:{...filters},update});
   if(options.dbError)return {error:{message:'private'},data:null};
   if(table==='customers')return {data:filters.line_user_id===uid?{id:'customer'}:null};
   const owned=filters.id===id&&filters.customer_id==='customer'&&!options.foreign;
   if(update)return {data:owned&&!options.race?{id}:null};
   return {data:owned?{id,status:options.cancelled?'cancelled':'confirmed'}:null};
  }};return q;
 }};
 const exports={};const logs=[];
 const source=ts.transpileModule(fs.readFileSync('app/api/webhook/line/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,require(name){if(name==='crypto')return crypto;if(name==='@/lib/billing')return {billingAdmin:()=>db};if(name==='next/server')return {NextResponse:{json:(body,init)=>new Response(JSON.stringify(body),init)}};throw Error(name)},process:{env:{LINE_CHANNEL_SECRET:'secret',LINE_CHANNEL_ACCESS_TOKEN:'private-token',LINE_BOOKING_CANCELLATION_ENABLED:options.disabled?'false':'true'}},Buffer,URLSearchParams,Date,console:{error:x=>logs.push(x)},fetch:async()=>{calls.push('reply');return {ok:!options.replyError}}});
 return {calls,logs,async run(event={},bad=false){const text=JSON.stringify({events:[{type:'postback',source:{type:'user',userId:uid},postback:{data:`action=cancel&bookingId=${id}`},replyToken:'reply',...event}]});return exports.POST(new Request('https://example.test',{method:'POST',body:text,headers:{'x-line-signature':bad?'bad':crypto.createHmac('sha256','secret').update(text).digest('base64')}}));}};
}
test('LINE cancellation stays disabled until identity protection is ready',async()=>{const f=fixture({disabled:true});assert.equal((await f.run()).status,503);assert.equal(f.calls.length,0)});
test('invalid signature cannot access the database',async()=>{const f=fixture();assert.equal((await f.run({},true)).status,401);assert.equal(f.calls.length,0)});
test('foreign booking cannot be cancelled or receive success reply',async()=>{const f=fixture({foreign:true});assert.equal((await f.run()).status,200);assert.equal(f.calls.some(x=>x.update||x==='reply'),false)});
test('group postback cannot use direct-user cancellation',async()=>{const f=fixture();await f.run({source:{type:'group',userId:uid}});assert.equal(f.calls.length,0)});
test('owned cancellation scopes mutation and then replies',async()=>{const f=fixture();assert.equal((await f.run()).status,200);const c=f.calls.find(x=>x.update);assert.deepEqual(c.filters,{id,customer_id:'customer',status:'confirmed'});assert.equal(f.calls.at(-1),'reply')});
test('database failure requests redelivery without success reply',async()=>{const f=fixture({dbError:true});assert.equal((await f.run()).status,503);assert.equal(f.calls.includes('reply'),false)});
test('concurrent status change cannot produce false cancellation confirmation',async()=>{const f=fixture({race:true});assert.equal((await f.run()).status,200);assert.equal(f.calls.includes('reply'),false)});
test('redelivery of cancelled booking does not write again',async()=>{const f=fixture({cancelled:true});assert.equal((await f.run()).status,200);assert.equal(f.calls.some(x=>x.update),false)});
test('reply error is recorded without undoing committed cancellation',async()=>{const f=fixture({replyError:true});assert.equal((await f.run()).status,200);assert.equal(f.calls.filter(x=>x.update).length,1);assert.deepEqual(f.logs,['LINE cancellation reply failed'])});
