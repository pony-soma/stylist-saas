const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');
function fixture(options = {}) {
  const calls = [];
  const exports = {};
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase/server': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: options.noAuth ? null : { id: 'verified-owner' } }, error: options.authError }) } }) },
    '@/lib/billing': {
      assertBillingOrigin: () => { if (options.badOrigin) throw Error(); },
      getBillingStatus: async () => { calls.push('billing'); return { status: options.status ?? 'active' }; },
      billingAdmin: () => ({ from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: options.missing ? null : { customer_id: 'aaaaaaaa-0000-4000-8000-000000000001' }, error: null }; } }), rpc: async (name, args) => { calls.push({ name, args }); return { data: options.dbError ? null : 'created-id', error: options.dbError }; } }),
    },
  };
  const code = ts.transpileModule(fs.readFileSync('app/api/medical-records/save/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name], console: { error() {} }, Date });
  return { calls, run: (body = valid) => exports.POST(new Request('https://example.test/api/customers', { method: 'POST', body: JSON.stringify(body) })) };
}
const customer = 'aaaaaaaa-0000-4000-8000-000000000001';
const valid = {action:'create',id:customer,customerId:customer,visit_date:'2026-09-15',treatment_menu:'  Cut  ',chemicals_used:'',notes:''};
const edit = {...valid,action:'update',customerId:undefined,expectedRevision:0};
test('medical save authenticates and validates origin',async()=>{
 for(const [o,status] of [[{noAuth:true},401],[{authError:{}},401],[{badOrigin:true},403]]){const f=fixture(o);assert.equal((await f.run()).status,status);assert.equal(f.calls.length,0);}
});
test('medical save denies forged owner, reparent, invalid calendar dates, unsafe versions and invalid fields',async()=>{
 for(const b of [null,[],{...valid,stylist_id:'foreign'},{...edit,customerId:customer},{...edit,expectedRevision:-1},{...edit,expectedRevision:0.5},{...edit,expectedRevision:9007199254740992},{...valid,visit_date:'2026-02-30'},{...valid,visit_date:'2026-9-15'},{...valid,treatment_menu:' '},{...valid,notes:'x'.repeat(10001)},{...valid,chemicals_used:'x'.repeat(5001)},{...valid,expectedRevision:0},{...valid,action:'delete'}]){const f=fixture();assert.equal((await f.run(b)).status,400);assert.equal(f.calls.length,0);}
});
test('medical mutation requires paid, trial or master access',async()=>{
 for(const status of ['expired','pending','canceled']){const f=fixture({status});assert.equal((await f.run()).status,403);assert.equal(f.calls.length,1);}
 for(const status of ['master','active','trialing']){const f=fixture({status});assert.equal((await f.run()).status,201);assert.equal(f.calls[1].args.p_stylist_id,'verified-owner');assert.equal(f.calls[1].args.p_treatment_menu,'Cut');assert.equal(f.calls[1].args.p_id,customer);}
});
test('medical update forwards exact version and no new customer',async()=>{
 const f=fixture();assert.equal((await f.run(edit)).status,200);assert.equal(f.calls[1].args.p_expected_revision,0);assert.equal(f.calls[1].args.p_customer_id,null);
});
test('medical DB failures preserve status without exposing DB content',async()=>{
 for(const [code,status] of [['42501',403],['P0002',404],['22023',400],['40001',409],['unexpected',503]]){const f=fixture({dbError:{code,message:'private'}});const r=await f.run();assert.equal(r.status,status);assert.equal(JSON.stringify(await r.json()).includes('private'),false);}
});
