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
      billingAdmin: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: options.dbError ? null : 'created-id', error: options.dbError }; } }),
    },
  };
  const code = ts.transpileModule(fs.readFileSync('app/api/customers/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name], console: { error() {} }, Date });
  return { calls, run: (body = { display_name: '山田 花子' }) => exports.POST(new Request('https://example.test/api/customers', { method: 'POST', body: JSON.stringify(body) })) };
}
test('customer registration rejects unauthenticated, auth failure and foreign origin before accessing database', async () => {
  for (const [options, status] of [[{ noAuth: true }, 401], [{ authError: {} }, 401], [{ badOrigin: true }, 403]]) {
    const f = fixture(options); assert.equal((await f.run()).status, status); assert.equal(f.calls.length, 0);
  }
});
test('customer registration never accepts owner, existing customer or LINE identity from caller', async () => {
  for (const extra of [{ stylist_id: 'foreign' }, { customer_id: 'existing' }, { line_user_id: 'U123' }, { line_picture_url: 'https://example.test' }, { is_master: true }]) {
    const f = fixture(); assert.equal((await f.run({ display_name: 'Valid', ...extra })).status, 400); assert.equal(f.calls.length, 0);
  }
});
test('customer registration validates malformed and oversized personal details', async () => {
  for (const body of [null, [], {}, { display_name: ' ' }, { display_name: 'a'.repeat(51) }, { display_name: 'a\nb' }, { display_name: 'a', phone_number: {} }, { display_name: 'a', phone_number: '123<script>' }, { display_name: 'a', birth_date: '2026-02-30' }, { display_name: 'a', birth_date: '9999-01-01' }, { display_name: 'a', gender: 'invalid' }, { display_name: 'a', memo: 'x'.repeat(5001) }]) {
    const f = fixture(); assert.equal((await f.run(body)).status, 400, JSON.stringify(body)); assert.equal(f.calls.length, 0);
  }
});
test('expired and pending accounts cannot create customers', async () => {
  for (const status of ['expired', 'pending']) {
    const f = fixture({ status }); assert.equal((await f.run()).status, 403); assert.equal(f.calls.length, 1);
  }
});
test('master, active and trialing owners use one atomic RPC with server-owned identity', async () => {
  for (const status of ['master', 'active', 'trialing']) {
    const f = fixture({ status }); const response = await f.run({ display_name: ' 山田 花子 ', phone_number: '090-1234-5678', birth_date: '2000-02-29', gender: 'female', memo: ' hello ' });
    assert.equal(response.status, 201); assert.deepEqual(await response.json(), { id: 'created-id' });
    const rpc = f.calls[1]; assert.equal(rpc.name, 'create_manual_customer');
    assert.deepEqual(JSON.parse(JSON.stringify(rpc.args)), { p_stylist_id: 'verified-owner', p_display_name: '山田 花子', p_phone_number: '090-1234-5678', p_birth_date: '2000-02-29', p_gender: 'female', p_memo: 'hello' });
    assert.equal(f.calls.length, 2);
  }
});
test('billing expiry caught inside the RPC returns denied instead of partial success', async () => {
  const f = fixture({ dbError: { code: '42501' } }); assert.equal((await f.run()).status, 403);
});
test('RPC failure returns generic retryable error without exposing database details', async () => {
  const f = fixture({ dbError: { code: '23503', message: 'private table info' } }); const response = await f.run(); assert.equal(response.status, 503); assert.equal(JSON.stringify(await response.json()).includes('private'), false);
});
