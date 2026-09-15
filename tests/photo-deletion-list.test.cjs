const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');
function fixture(options={}) {
 const calls=[]; const exports={};
 const query={ select(v){calls.push(['select',v]);return this;},eq(k,v){calls.push(['eq',k,v]);return this;},is(k,v){calls.push(['is',k,v]);return this;},order(k){calls.push(['order',k]);return this;},async limit(v){calls.push(['limit',v]);return {data:[{photo_id:'own-photo'}],error:options.dbError};}};
 const mocks={
  'next/server':{NextResponse:{json:(body,opts)=>Response.json(body,opts)}},
  '@/lib/supabase/server':{createClient:()=>({auth:{getUser:async()=>({data:{user:options.noAuth?null:{id:'owner'}},error:options.authError})}})},
  '@/lib/billing':{billingAdmin:()=>({from(t){calls.push(['table',t]);return query;}})},
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/record-photos/deletions/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:n=>mocks[n]});
 return {run:()=>exports.GET(),calls};
}
test('pending photo cleanup requires verified authentication before accessing jobs',async()=>{
 for(const o of [{noAuth:true},{authError:{}}]){const f=fixture(o);assert.equal((await f.run()).status,401);assert.equal(f.calls.length,0);}
});
test('pending cleanup list restricts exact owner and incomplete jobs, omits paths and allows expired users',async()=>{
 const f=fixture();const r=await f.run();assert.equal(r.status,200);assert.deepEqual(await r.json(),{photoIds:['own-photo']});
 assert.deepEqual(f.calls,[['table','photo_deletion_jobs'],['select','photo_id'],['eq','stylist_id','owner'],['is','completed_at',null],['order','requested_at'],['limit',100]]);
 assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('vary'),'Cookie');
});
test('cleanup list database failure returns no partial job details',async()=>{
 const f=fixture({dbError:{message:'private-path'}});const r=await f.run();assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'Photo deletion status unavailable'});
});
