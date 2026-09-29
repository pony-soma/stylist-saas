const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');
const customerId = '11111111-1111-4111-8111-111111111111';
function fixture(options = {}) {
  const calls = [];
  const exports = {};
  const query = {
    update: value => { calls.push(['update', value]); return query; },
    eq: (field, value) => { calls.push([field, value]); return query; },
    select: () => query,
    maybeSingle: async () => ({ data: options.missing ? null : { customer_id: customerId }, error: options.dbError }),
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase/server': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: options.noAuth ? null : { id: 'verified-owner' } }, error: options.authError }) } }) },
    '@/lib/billing': {
      assertBillingOrigin: () => { if (options.badOrigin) throw Error(); },
      getBillingStatus: async () => ({ status: options.status ?? 'active' }),
      billingAdmin: () => ({ from: name => { calls.push(['table', name]); return query; } }),
    },
  };
  const code = ts.transpileModule(fs.readFileSync('app/api/customers/archive/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name], console: { error() {} }, Date });
  return { calls, run: (body = { customerId, archived: true }) => exports.PATCH(new Request('https://example.test/api/customers/archive', { method: 'PATCH', body: JSON.stringify(body) })) };
}
test('archive and restore require authentication, allowed origin and active access', async () => {
  for (const [options, status] of [[{ noAuth: true }, 401], [{ authError: {} }, 401], [{ badOrigin: true }, 403], [{ status: 'expired' }, 403]]) {
    const f = fixture(options); assert.equal((await f.run()).status, status); assert.equal(f.calls.length, 0);
  }
});
test('owner overrides, invalid identifiers and non-boolean states are rejected', async () => {
  for (const body of [null, [], {}, { customerId, archived: 'false' }, { customerId: 'bad', archived: true }, { customerId, archived: true, stylist_id: 'foreign' }]) {
    const f = fixture(); assert.equal((await f.run(body)).status, 400); assert.equal(f.calls.length, 0);
  }
});
test('archive and restore update only verified owner relationship, never customer or records', async () => {
  for (const archived of [true, false]) {
    const f = fixture(); assert.equal((await f.run({ customerId, archived })).status, 200);
    assert.deepEqual(f.calls.filter(c => c[0] !== 'update'), [['table', 'stylist_customers'], ['stylist_id', 'verified-owner'], ['customer_id', customerId]]);
    const value = f.calls.find(c => c[0] === 'update')[1];
    assert.deepEqual(Object.keys(value), ['archived_at']);
    if (archived) assert.ok(Number.isFinite(Date.parse(value.archived_at))); else assert.equal(value.archived_at, null);
  }
});
test('missing or foreign relationship returns 404; database failure never reports success', async () => {
  assert.equal((await fixture({ missing: true }).run()).status, 404);
  const result = await fixture({ dbError: { message: 'private-data' } }).run();
  assert.equal(result.status, 503); assert.equal((await result.text()).includes('private-data'), false);
});
