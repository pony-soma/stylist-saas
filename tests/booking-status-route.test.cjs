const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const ts=require('typescript');
const bookingId='11111111-1111-4111-8111-111111111111';
function fixture(o={}){
 const calls=[];const db={from(){let update;const filters={};const q={select(){return q},eq(k,v){filters[k]=v;return q},update(v){update=v;return q},async maybeSingle(){calls.push({filters:{...filters},update});if(o.dbError)return {error:{message:'secret'}};if(o.foreign)return {data:null};return {data:update?(o.race?null:{id:bookingId}):{id:bookingId,status:o.state||'pending'}}}};return q}};
 const exports={};const mocks={'next/server':{NextResponse:{json:(v,i)=>new Response(JSON.stringify(v),i)}},'@/lib/supabase/server':{createClient:()=>({auth:{getUser:async()=>({data:{user:o.noAuth?null:{id:'owner'}}})}})},'@/lib/billing':{assertBillingOrigin:()=>{if(o.badOrigin)throw Error()},billingAdmin:()=>db,getBillingStatus:async()=>{calls.push('billing');return {status:o.billing||'active'}}}};
 const code=ts.transpileModule(fs.readFileSync('app/api/bookings/status/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>mocks[n],console:{error(){}},Date});
 return {calls,run:(status='cancelled',extra={})=>exports.POST(new Request('https://example.test',{method:'POST',body:JSON.stringify({bookingId,status,...extra})}))};
}
test('booking action rejects unauthenticated and cross-origin requests',async()=>{for(const [o,status] of [[{noAuth:true},401],[{badOrigin:true},403]]){const f=fixture(o);assert.equal((await f.run()).status,status);assert.equal(f.calls.length,0)}});
test('booking action refuses arbitrary column changes',async()=>{const f=fixture();assert.equal((await f.run('cancelled',{stylist_id:'attacker'})).status,400);assert.equal(f.calls.length,0)});
test('expired owner can cancel existing booking without gaining edit rights',async()=>{const f=fixture({billing:'expired'});assert.equal((await f.run()).status,200);assert.equal(f.calls.includes('billing'),false);const write=f.calls.find(c=>c.update);assert.deepEqual(write.filters,{id:bookingId,stylist_id:'owner',status:'pending'});assert.deepEqual(Object.keys(write.update).sort(),['status','updated_at'])});
test('expired owner cannot confirm new work',async()=>{const f=fixture({billing:'expired'});assert.equal((await f.run('confirmed')).status,403);assert.equal(f.calls.some(c=>c.update),false)});
test('foreign booking cannot be modified',async()=>{const f=fixture({foreign:true});assert.equal((await f.run()).status,404);assert.equal(f.calls.some(c=>c.update),false)});
test('master and active trial can confirm pending booking',async()=>{for(const billing of ['master','active','trialing']){const f=fixture({billing});assert.equal((await f.run('confirmed')).status,200)}});
test('cancelled or completed bookings cannot be confirmed again',async()=>{for(const state of ['cancelled','completed']){const f=fixture({state});assert.equal((await f.run('confirmed')).status,409);assert.equal(f.calls.some(c=>c.update),false)}});
test('zero-row update reports concurrent change',async()=>{const f=fixture({race:true});assert.equal((await f.run()).status,409)});
test('database failure returns retryable service failure',async()=>{const f=fixture({dbError:true});assert.equal((await f.run()).status,503)});
test('repeated cancellation is idempotent',async()=>{const f=fixture({state:'cancelled'});assert.equal((await f.run()).status,200);assert.equal(f.calls.some(c=>c.update),false)});
