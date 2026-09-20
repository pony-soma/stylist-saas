const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');
const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const menu = { action: 'menu.create', name: 'カット', duration: 60, price: 5000 };
const setting = { day_of_week: 1, specific_date: null, start_time: '09:00', end_time: '18:00', is_day_off: false };
const batch = { action: 'availability.save', settings: [setting] };
function fixture(options = {}) {
  const calls = [], exports = {};
  const mocks = {
    'node:crypto': { randomUUID: () => otherId },
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase/server': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: options.noAuth ? null : { id: 'verified-owner' } }, error: options.authError }) } }) },
    '@/lib/billing': {
      assertBillingOrigin: () => { if (options.badOrigin) throw Error(); },
      getBillingStatus: async () => { calls.push('billing'); return { status: options.status ?? 'active' }; },
      acquireBillingLock: async owner => { calls.push({ lock: owner }); return options.busy ? null : 'token'; },
      releaseBillingLock: async (owner, token) => { calls.push({ release: owner, token }); },
      billingAdmin: () => ({ from: table => {
        const call = { table, operation: 'read', filters: [] }; calls.push(call);
        const query = {
          select() { return query; },
          eq(key, value) { call.filters.push([key, value]); return query; },
          update(value) { call.operation = 'update'; call.value = value; return query; },
          delete() { call.operation = 'delete'; return query; },
          insert(value) { call.operation = 'insert'; call.value = value; return query; },
          upsert(value, config) { call.operation = 'upsert'; call.value = value; call.config = config; return query; },
          then(resolve, reject) { return Promise.resolve({ data: call.operation === 'read' ? options.existing ?? [] : options.noMatch ? [] : [{ id }], error: options.dbError && (!options.errorOperation || options.errorOperation === call.operation) ? { message: 'private information' } : null }).then(resolve, reject); },
        }; return query;
      } }),
    },
  };
  const code = ts.transpileModule(fs.readFileSync('app/api/settings/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name], console: { error() {} }, Date });
  return { calls, run: (body = menu) => exports.POST(new Request('https://example.test/api/settings', { method: 'POST', body: JSON.stringify(body) })) };
}
test('settings require authenticated identity and same origin before database access', async () => {
  for (const [options, status] of [[{ noAuth: true }, 401], [{ authError: {} }, 401], [{ badOrigin: true }, 403]]) {
    const f = fixture(options); assert.equal((await f.run()).status, status); assert.equal(f.calls.length, 0);
  }
});
test('settings reject owner forgery, invalid fields, fractional and overflow prices, invalid times and dates before writes', async () => {
  for (const body of [null, [], {}, { ...menu, stylist_id: 'foreign' }, { ...menu, price: 1.5 }, { ...menu, price: -1 }, { ...menu, price: 10000001 }, { ...menu, duration: 0 }, { ...menu, duration: 1441 }, { ...menu, name: 'x\ny' }, { ...menu, id }, { action: 'availability.save', settings: [{ ...setting, stylist_id: 'foreign' }] }, { action: 'availability.save', settings: [{ ...setting, start_time: '24:00' }] }, { action: 'availability.save', settings: [{ ...setting, end_time: '08:00' }] }, { action: 'availability.save', settings: [{ ...setting, day_of_week: null, specific_date: '2026-02-30' }] }, { action: 'availability.save', settings: [setting, setting] }, { action: 'blocked.create', title: '休憩', start_time: '2026-01-01T12:00:00', end_time: '2026-01-01T13:00:00' }]) {
    const f = fixture(); assert.equal((await f.run(body)).status, 400, JSON.stringify(body)); assert.equal(f.calls.length, 0);
  }
});
test('all settings actions reject expired access including deletes', async () => {
  for (const body of [menu, { ...menu, action: 'menu.update', id }, { action: 'menu.delete', id }, batch, { action: 'availability.delete', id }, { action: 'blocked.delete', id }, { action: 'blocked.create', title: '休憩', start_time: '2026-01-01T12:00:00Z', end_time: '2026-01-01T13:00:00Z' }]) {
    const f = fixture({ status: 'expired' }); assert.equal((await f.run(body)).status, 403); assert.deepEqual(f.calls, ['billing']);
  }
});
test('menu creation permits active trial and master, server assigns owner and trims name', async () => {
  for (const status of ['active', 'trialing', 'master']) {
    const f = fixture({ status }); assert.equal((await f.run({ ...menu, name: ' カット ' })).status, 200);
    assert.equal(f.calls[1].value.stylist_id, 'verified-owner'); assert.equal(f.calls[1].value.name, 'カット');
  }
});
test('menu update and every delete scope both row id and owner, foreign rows are not reported successful', async () => {
  for (const body of [{ ...menu, action: 'menu.update', id }, { action: 'menu.delete', id }, { action: 'availability.delete', id }, { action: 'blocked.delete', id }]) {
    const f = fixture({ noMatch: true }); assert.equal((await f.run(body)).status, 404);
    const mutation = f.calls.find(c => c.table); assert.deepEqual(JSON.parse(JSON.stringify(mutation.filters)), [['id', id], ['stylist_id', 'verified-owner']]);
  }
});
test('availability rejects foreign IDs and conflicting natural keys without an upsert, releasing lock', async () => {
  for (const [existing, settings, status] of [[[], [{ ...setting, id }], 404], [[{ ...setting, id }, { ...setting, id: otherId }], [setting], 409], [[{ ...setting, id }], [{ ...setting, id, day_of_week: 2 }], 409]]) {
    const f = fixture({ existing }); assert.equal((await f.run({ action: 'availability.save', settings })).status, status);
    assert.equal(f.calls.some(c => c.operation === 'upsert'), false); assert.equal(f.calls.at(-1).release, 'verified-owner');
  }
});
test('availability serializes a seven-day save and uses one atomic upsert preserving existing owned ID', async () => {
  const f = fixture({ existing: [{ ...setting, id }] });
  const settings = Array.from({ length: 7 }, (_, day_of_week) => ({ ...setting, day_of_week, is_day_off: day_of_week === 0 }));
  assert.equal((await f.run({ action: 'availability.save', settings })).status, 200);
  const writes = f.calls.filter(c => c.operation === 'upsert'); assert.equal(writes.length, 1); assert.equal(writes[0].value.length, 7);
  assert.equal(writes[0].value[1].id, id); assert.equal(writes[0].value[0].start_time, null);
  assert.equal(writes[0].value.every(row => row.stylist_id === 'verified-owner'), true);
  assert.equal(f.calls[1].lock, 'verified-owner'); assert.equal(f.calls.at(-1).release, 'verified-owner');
});
test('busy availability lock prevents reads and writes', async () => {
  const f = fixture({ busy: true }); assert.equal((await f.run(batch)).status, 409); assert.equal(f.calls.some(c => c.table), false);
});
test('read or write failure returns generic failure and releases acquired availability lock', async () => {
  for (const errorOperation of ['read', 'upsert']) {
    const f = fixture({ dbError: true, errorOperation }); const response = await f.run(batch);
    assert.equal(response.status, 503); assert.equal(JSON.stringify(await response.json()).includes('private'), false); assert.equal(f.calls.at(-1).release, 'verified-owner');
    if (errorOperation === 'read') assert.equal(f.calls.some(c => c.operation === 'upsert'), false);
  }
  const f = fixture({ dbError: true }); assert.equal((await f.run()).status, 503);
});
