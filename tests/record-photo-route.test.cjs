const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');
const id = 'aaaaaaaa-0000-4000-8000-000000000001';
function fixture(options = {}) {
  const calls = [];
  const exports = {};
  const query = {
    select(value) { calls.push(['select', value]); return this; },
    eq(key, value) { calls.push(['eq', key, value]); return this; },
    async maybeSingle() { return { data: options.missing ? null : {
      storage_path: options.path ?? 'customer/record/photo.jpg',
      medical_records: { stylist_id: options.foreign ? 'someone-else' : 'verified-owner' },
    }, error: options.dbError }; },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase/server': { createClient: () => ({
      auth: { getUser: async () => ({ data: { user: options.noAuth ? null : { id: 'verified-owner' } }, error: options.authError }) },
      from(table) { calls.push(['from', table]); return query; },
    }) },
    '@/lib/billing': { billingAdmin: () => ({ storage: {
      async getBucket(bucket) { calls.push(['bucket', bucket]); return { data: { public: options.publicBucket ?? false }, error: options.bucketError }; },
      from(bucket) { calls.push(['download-bucket', bucket]); return { async download(path) {
        calls.push(['download', path]); return { data: new Blob(['synthetic-image'], { type: options.mime ?? 'image/jpeg' }), error: options.downloadError };
      } }; },
    } }) },
  };
  const code = ts.transpileModule(fs.readFileSync('app/api/record-photos/[id]/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name], Response, console: { error() {} } });
  return { calls, run: (photoId = id, headers) => exports.GET(new Request('https://example.test/api/record-photos/' + photoId, { headers }), { params: { id: photoId } }) };
}
test('photos require authenticated owner and reject malformed IDs/cross-site embedding', async () => {
  for (const options of [{ noAuth: true }, { authError: {} }]) {
    const f = fixture(options); assert.equal((await f.run()).status, 401); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); assert.equal((await f.run('../secret')).status, 400);
  assert.equal((await f.run(id, { 'sec-fetch-site': 'cross-site' })).status, 403); assert.equal(f.calls.length, 0);
});
test('missing or foreign photos never access storage, including master-equivalent caller', async () => {
  for (const options of [{ missing: true }, { foreign: true }]) {
    const f = fixture(options); assert.equal((await f.run()).status, 404);
    assert.ok(f.calls.some(c => c[0] === 'eq' && c[1] === 'medical_records.stylist_id' && c[2] === 'verified-owner'));
    assert.equal(f.calls.some(c => c[0] === 'bucket'), false);
  }
});
test('owner can read without billing authorization and private images are never publicly cached', async () => {
  const f = fixture(); const response = await f.run(); assert.equal(response.status, 200);
  assert.equal(await response.text(), 'synthetic-image');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
});
test('public or inaccessible bucket fails closed before download', async () => {
  for (const options of [{ publicBucket: true }, { bucketError: {} }]) {
    const f = fixture(options); assert.equal((await f.run()).status, 503);
    assert.equal(f.calls.some(c => c[0] === 'download'), false);
  }
});
test('invalid stored paths never access storage', async () => {
  for (const path of ['/private.jpg', '../other.jpg', 'a/../b.jpg', 'a\\b.jpg', 'a//b.jpg']) {
    const f = fixture({ path }); assert.equal((await f.run()).status, 404);
    assert.equal(f.calls.some(c => c[0] === 'bucket'), false);
  }
});
test('database, storage failure and executable image types are not exposed', async () => {
  for (const [options, status] of [[{ dbError: {} }, 503], [{ downloadError: {} }, 503], [{ mime: 'image/svg+xml' }, 415]]) {
    const f = fixture(options); const r = await f.run(); assert.equal(r.status, status);
    assert.deepEqual(await r.json(), { error: 'Photo unavailable' });
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  }
});
