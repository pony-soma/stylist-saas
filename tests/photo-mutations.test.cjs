const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');
const id = 'aaaaaaaa-0000-4000-8000-000000000001';
const recordId = 'bbbbbbbb-0000-4000-8000-000000000001';
const owner = 'cccccccc-0000-4000-8000-000000000001';
const code = ts.transpileModule(fs.readFileSync('lib/photo-mutations.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(o = {}) {
  const calls = []; let inserted; let billingCalls = 0;
  const photo = { id, record_id: recordId, storage_path: `${owner}/${recordId}/${id}.jpg`, medical_records: { stylist_id: o.foreign ? 'other' : owner } };
  function query(table, admin) {
    let op = 'select';
    const q = {
      select(...args) { calls.push(['select', table, ...args]); return q; },
      eq(...args) { calls.push(['eq', ...args]); return q; },
      insert(row) { inserted = row; calls.push(['insert', row]); return Promise.resolve({ error: o.insertError }); },
      delete() { op = 'delete'; calls.push(['delete']); return q; },
      maybeSingle() {
        if (admin) return Promise.resolve({ data: o.lookupMissing ? null : o.committed ? { ...inserted, ...(o.wrongCommitted ? { storage_path: 'wrong' } : {}) } : photo, error: o.lookupError });
        return Promise.resolve({ data: o.missing ? null : table === 'medical_records' ? { id: recordId, stylist_id: o.foreign ? 'other' : owner } : photo, error: o.dbError });
      },
      then(resolve, reject) { return Promise.resolve(op === 'delete' ? { data: o.zeroDelete ? [] : [{ id }], error: o.deleteError } : { count: o.references ?? 1, error: o.referencesError }).then(resolve, reject); },
    }; return q;
  }
  const storage = {
    async upload(path, bytes, options) { calls.push(['upload', path, bytes.length, options]); return { error: o.uploadError }; },
    async remove(paths) { calls.push(['remove', paths]); return { error: o.removeError }; },
  };
  const mocks = {
    'node:crypto': { randomUUID: () => id },
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase/server': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: o.noAuth ? null : { id: owner } } }) }, from: table => query(table, false) }) },
    '@/lib/billing': {
      assertBillingOrigin(request) { if (request.headers.get('origin') !== 'https://example.test') throw Error(); },
      getBillingStatus: async () => ({ status: ++billingCalls > 1 && o.expireLater ? 'expired' : o.status ?? 'active' }),
      billingAdmin: () => ({ rpc: async (name, args) => {
        calls.push(['rpc', name, args]);
        if (name === 'complete_photo_deletion') return { data: o.finishFalse ? false : true, error: o.finishError };
        const error = o.rpcError ?? (o.foreign ? { code: 'P0002' } : o.status === 'expired' && !o.existingJob ? { code: '42501' } : o.references === 2 ? { code: '40001' } : null);
        return { data: error ? null : { photo_id: id, stylist_id: owner, storage_path: photo.storage_path, completed_at: o.completed ? '2026-09-15' : null }, error };
      }, from: table => query(table, true), storage: { getBucket: async () => ({ data: { public: o.publicBucket ?? false }, error: o.bucketError }), from: () => storage } }),
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => mocks[name], Response, Uint8Array, console: { error() {} } });
  const req = (body, origin = 'https://example.test') => new Request('https://example.test/api/record-photos', { method: 'POST', headers: { origin }, body });
  return { calls, upload: (request) => exports.uploadPhoto(request ?? req(form())), delete: (origin = 'https://example.test') => exports.deletePhoto(req(null, origin), id), req };
}
function form(bytes = [255, 216, 255, 0], mime = 'image/jpeg') {
  const f = new FormData(); f.set('recordId', recordId); f.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), 'photo.jpg'); return f;
}
test('photo writes require Origin, authentication and unexpired billing', async () => {
  for (const [o, status] of [[{ noAuth: true }, 401], [{ status: 'expired' }, 403]]) {
    for (const action of ['upload', 'delete']) { const f = fixture(o); assert.equal((await f[action]()).status, status); assert.ok(!f.calls.some(c => ['upload','remove'].includes(c[0]))); }
  }
  const f = fixture(); assert.equal((await f.upload(f.req(form(), 'https://evil.test'))).status, 403); assert.equal((await f.delete('https://evil.test')).status, 403); assert.equal(f.calls.length, 0);
});
test('foreign ownership rejected even for master and no storage touched', async () => {
  for (const status of ['active', 'master']) for (const action of ['upload', 'delete']) {
    const f = fixture({ foreign: true, status }); assert.equal((await f[action]()).status, 404); assert.ok(!f.calls.some(c => ['upload', 'remove', 'insert', 'delete'].includes(c[0])));
  }
});
test('upload persists server-generated path and private response', async () => {
  const f = fixture(); const r = await f.upload(); assert.equal(r.status, 201); assert.deepEqual(await r.json(), { id }); assert.equal(r.headers.get('cache-control'), 'private, no-store'); assert.equal(f.calls.find(c => c[0] === 'upload')[3].upsert, false);
});
test('MIME alone cannot authorize an upload; malformed forms rejected', async () => {
  for (const [bytes, mime] of [[[1,2,3,4], 'image/jpeg'], [[255,216,255,0], 'image/png'], [[255,216,255,0], 'image/svg+xml']]) {
    const f = fixture(); assert.equal((await f.upload(f.req(form(bytes, mime)))).status, 415); assert.ok(!f.calls.some(c => c[0] === 'upload'));
  }
  const f = fixture(); const body = form(); body.append('recordId', recordId); assert.equal((await f.upload(f.req(body))).status, 400);
});
test('chunked bodies exceeding 4 MiB rejected without relying on Content-Length', async () => {
  const f = fixture(); const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(3 * 1024 * 1024)); c.enqueue(new Uint8Array(2 * 1024 * 1024)); c.close(); } });
  const request = new Request('https://example.test/api/record-photos', { method: 'POST', duplex: 'half', headers: { origin: 'https://example.test', 'content-type': 'multipart/form-data; boundary=x' }, body: stream });
  assert.equal((await f.upload(request)).status, 413); assert.ok(!f.calls.some(c => c[0] === 'upload'));
});
test('public/inaccessible buckets and storage errors fail closed', async () => {
  for (const o of [{ publicBucket: true }, { bucketError: {} }]) for (const action of ['upload', 'delete']) { const f = fixture(o); assert.equal((await f[action]()).status, action === 'delete' ? 202 : 503); assert.ok(!f.calls.some(c => ['upload', 'remove'].includes(c[0]))); }
  const u = fixture({ uploadError: {} }); assert.equal((await u.upload()).status, 503); assert.ok(!u.calls.some(c => c[0] === 'insert'));
  const d = fixture({ removeError: {} }); assert.equal((await d.delete()).status, 202); assert.ok(!d.calls.some(c => c[0] === 'delete'));
});
test('insert lost acknowledgement recovered only for exact id, parent and path', async () => {
  const good = fixture({ insertError: {}, committed: true }); assert.equal((await good.upload()).status, 201); assert.ok(!good.calls.some(c => c[0] === 'remove'));
  for (const o of [{ committed: true, wrongCommitted: true }, { lookupError: {} }]) { const f = fixture({ insertError: {}, ...o }); assert.equal((await f.upload()).status, 503); assert.ok(!f.calls.some(c => c[0] === 'remove')); }
  const absent = fixture({ insertError: {}, lookupMissing: true }); assert.equal((await absent.upload()).status, 503); assert.ok(absent.calls.some(c => c[0] === 'remove'));
});
test('expiry during transfer prevents metadata write and compensates object when absent', async () => {
  const f = fixture({ expireLater: true, lookupMissing: true }); assert.equal((await f.upload()).status, 403); assert.ok(!f.calls.some(c => c[0] === 'insert')); assert.ok(f.calls.some(c => c[0] === 'remove'));
});
test('deletion requires unshared path and performs durable intent before object cleanup', async () => {
  const shared = fixture({ references: 2 }); assert.equal((await shared.delete()).status, 409); assert.ok(!shared.calls.some(c => c[0] === 'remove'));
  const good = fixture(); const response = await good.delete(); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { deleted: true, cleanupPending: false });
  assert.deepEqual(good.calls.filter(c => ['rpc','remove'].includes(c[0])).map(c => c[0] === 'rpc' ? c[1] : c[0]), ['request_photo_deletion','remove','complete_photo_deletion']);
});
test('Storage and completion failures stay pending with retryable photo ID', async () => {
  for (const o of [{ removeError: {} }, { finishError: {} }, { finishFalse: true }]) {
    const f = fixture(o); const r = await f.delete(); assert.equal(r.status, 202); assert.deepEqual(await r.json(), { deleted: true, cleanupPending: true, photoId: id });
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    if (o.removeError) assert.ok(!f.calls.some(c => c[1] === 'complete_photo_deletion'));
  }
});
test('authorized cleanup can retry after expiry, completed requests skip Storage', async () => {
  const retry = fixture({ status: 'expired', existingJob: true }); assert.equal((await retry.delete()).status, 200); assert.ok(retry.calls.some(c => c[0] === 'remove'));
  const done = fixture({ status: 'expired', existingJob: true, completed: true }); assert.equal((await done.delete()).status, 200); assert.ok(!done.calls.some(c => c[0] === 'remove'));
  const lost = fixture({ rpcError: { code: 'XX000' } }); assert.equal((await lost.delete()).status, 503); assert.ok(!lost.calls.some(c => c[0] === 'remove'));
});
