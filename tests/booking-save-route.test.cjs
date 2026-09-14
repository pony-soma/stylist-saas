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
  const code = ts.transpileModule(fs.readFileSync('app/api/bookings/save/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name], console: { error() {} }, Date });
  return { calls, run: (body = valid) => exports.POST(new Request('https://example.test/api/customers', { method: 'POST', body: JSON.stringify(body) })) };
}
const customer = 'aaaaaaaa-0000-4000-8000-000000000001';
const valid = { customerId: customer, requestId: 'aaaaaaaa-0000-4000-8000-000000000002', startTime: '2026-10-01T10:00:00+09:00', endTime: '2026-10-01T11:00:00+09:00', menuIds: [], menuNote: 'Test' };
const edit = { bookingId: customer, expectedUpdatedAt: '2026-09-14T08:00:00.123456Z', startTime: valid.startTime, endTime: valid.endTime, menuIds: [], menuNote: '' };
test('booking save authenticates and rejects foreign origin', async () => {
  for (const [options, expected] of [[{ noAuth: true },401],[{authError:{}},401],[{badOrigin:true},403]]) {
    const f=fixture(options); assert.equal((await f.run()).status,expected); assert.equal(f.calls.length,0);
  }
});
test('booking save rejects forged ownership/price, duplicate menus and invalid time/input', async () => {
  for (const body of [null, [], {...valid,stylist_id:'foreign'}, {...valid,totalPrice:1}, {...valid,menuIds:[customer,customer]}, {...valid,endTime:valid.startTime}, {...valid,startTime:'2026-10-01T10:00:00'}, {...valid,requestId:undefined}, {...edit,expectedUpdatedAt:undefined}, {...edit,customerId:customer}]) {
    const f=fixture(); assert.equal((await f.run(body)).status,400); assert.equal(f.calls.length,0);
  }
});
test('expired or pending accounts cannot save', async () => {
  for(const status of ['expired','pending']) { const f=fixture({status}); assert.equal((await f.run()).status,403); }
});
test('create uses verified owner and exact request id, never client prices', async () => {
  for(const status of ['master','active','trialing']) {
    const f=fixture({status}); assert.equal((await f.run()).status,201);
    const rpc=f.calls[1]; assert.equal(rpc.name,'save_proxy_booking'); assert.equal(rpc.args.p_stylist_id,'verified-owner');
    assert.equal(rpc.args.p_request_id,valid.requestId); assert.equal(rpc.args.p_customer_id,customer); assert.equal(rpc.args.p_booking_id,null);
  }
});
test('edit requires own existing booking and forwards exact optimistic version', async () => {
  const missing=fixture({missing:true}); assert.equal((await missing.run(edit)).status,404);
  const f=fixture(); assert.equal((await f.run(edit)).status,200);
  assert.equal(f.calls[1].args.p_customer_id,customer); assert.equal(f.calls[1].args.p_expected_updated_at,edit.expectedUpdatedAt);
});
test('RPC authorization, conflicts and validation failures map to actionable status', async () => {
  for(const [code,status] of [['42501',403],['P0002',404],['22023',400],['40001',409],['unexpected',503]]) {
    const f=fixture({dbError:{code,message:'private'}}); const r=await f.run(); assert.equal(r.status,status); assert.equal(JSON.stringify(await r.json()).includes('private'),false);
  }
});
