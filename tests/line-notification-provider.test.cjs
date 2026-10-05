const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(route, env) {
  const calls = [], writes = [], exports = {};
  const query = { update(v) { writes.push(v); return this; }, eq() { return this; }, select() { return this; }, async single() { return { data: { id: 'stylist' } }; } };
  const mocks = {
    'next/server': { NextResponse: { redirect: u => Response.redirect(u, 307), json: (v, init) => Response.json(v, init) } },
    'next/headers': { cookies: () => ({ set() {}, get: () => ({ value: 'state' }), delete() {} }) },
    '@/lib/supabase/server': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'stylist' } } }) }, from: () => query }) },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(route, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: id => mocks[id], URL, URLSearchParams, Math, console,
    process: { env: { NEXT_PUBLIC_APP_URL: 'https://example.test', LINE_LOGIN_CHANNEL_ID: 'customer-channel', LINE_LOGIN_CHANNEL_SECRET: 'customer-secret', ...env } },
    fetch: async (url, options) => { calls.push({ url, body: options.body }); return Response.json(url.endsWith('/token') ? { id_token: 'token' } : { sub: 'notification-provider-user' }); },
  });
  return { calls, writes, run: () => exports.GET(new Request('https://example.test/api/auth/line/callback?code=code&state=state')) };
}
const start = 'app/api/auth/line/route.ts';
const callback = 'app/api/auth/line/callback/route.ts';
test('notification login uses the same dedicated channel for authorize, exchange and verify', async () => {
  const env = { LINE_NOTIFICATION_LOGIN_CHANNEL_ID: 'notification-channel', LINE_NOTIFICATION_LOGIN_CHANNEL_SECRET: 'notification-secret' };
  const initial = await load(start, env).run();
  assert.equal(new URL(initial.headers.get('location')).searchParams.get('client_id'), 'notification-channel');
  const f = load(callback, env);
  const result = await f.run();
  assert.ok(result.headers.get('location').endsWith('success=line_linked'));
  assert.equal(f.calls[0].body.get('client_id'), 'notification-channel');
  assert.equal(f.calls[0].body.get('client_secret'), 'notification-secret');
  assert.equal(f.calls[1].body.get('client_id'), 'notification-channel');
  assert.equal(f.writes[0].line_user_id, 'notification-provider-user');
});
for (const env of [{ LINE_NOTIFICATION_LOGIN_CHANNEL_ID: 'notification-channel' }, { LINE_NOTIFICATION_LOGIN_CHANNEL_SECRET: 'notification-secret' }]) {
  test('partial notification credentials fail closed: ' + Object.keys(env)[0], async () => {
    assert.equal((await load(start, env).run()).status, 500);
    const f = load(callback, env);
    assert.ok((await f.run()).headers.get('location').endsWith('error=missing_credentials'));
    assert.equal(f.calls.length, 0);
    assert.equal(f.writes.length, 0);
  });
}
test('existing deployments without a dedicated channel retain their login pair', async () => {
  const initial = await load(start, {}).run();
  assert.equal(new URL(initial.headers.get('location')).searchParams.get('client_id'), 'customer-channel');
  const f = load(callback, {}); await f.run();
  assert.equal(f.calls[0].body.get('client_secret'), 'customer-secret');
  assert.equal(f.calls[1].body.get('client_id'), 'customer-channel');
});
