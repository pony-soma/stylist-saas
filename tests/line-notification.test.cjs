const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
class MockHTTPFetchError extends Error { constructor(status) { super('mock SDK failure'); this.status = status; } }
const bookingId = '8ca177ea-0f82-4ce0-8cf0-7d90b3ad30ec';
const customerLine = `U${'1'.repeat(32)}`, stylistLine = `U${'2'.repeat(32)}`;
function fixture(options = {}) {
  const sent = [], requests = [], reads = [];
  const booking = { id: bookingId, customer_id: 'customer', stylist_id: 'stylist', status: 'pending', source: 'liff', created_at: new Date(Date.now()-1000).toISOString(), start_time: '2026-10-01T01:00:00Z', selected_menus: [{ name: 'DBカット' }], total_price: 5000, menu_note: 'DB備考', ...options.booking };
  const rows = { bookings: options.missing ? null : booking, customers: { line_user_id: options.otherOwner ? `U${'3'.repeat(32)}` : customerLine, display_name: 'DB顧客' }, stylists: { line_user_id: stylistLine } };
  const mocks = {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@line/bot-sdk': { HTTPFetchError: MockHTTPFetchError, messagingApi: { MessagingApiClient: class { async pushMessage(...args) { sent.push(args); if (options.alreadyAccepted) throw new MockHTTPFetchError(409); if (options.pushFailure) throw new Error('sensitive-sdk-error'); } } } },
    '@/lib/billing': { billingAdmin: () => ({ from: table => { reads.push(table); const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: rows[table], error: options.dbError || null }) }; return query; } }) },
  };
  const compiled = ts.transpileModule(fs.readFileSync('lib/booking-notification.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => mocks[id], process: { env: { LINE_LOGIN_CHANNEL_ID: 'channel', LINE_CHANNEL_ACCESS_TOKEN: 'dummy', LINE_BOOKING_NOTIFICATIONS_ENABLED: options.disabled ? 'false' : 'true' } }, Date, AbortSignal, console: { error() {} }, fetch: async (url, init) => { requests.push({ url, init }); if(url.endsWith('/v2/bot/message/push')) { sent.push([JSON.parse(init.body),init.headers['X-Line-Retry-Key']]); if(options.pushFailure) throw new Error('sensitive-sdk-error'); return Response.json({}, {status: options.alreadyAccepted?409:200,headers:options.alreadyAccepted?{'x-line-accepted-request-id':'accepted'}:{}}); } return url.includes('/verify?') ? Response.json({ client_id: options.wrongChannel ? 'other' : 'channel', expires_in: options.expired ? 0 : 100 }, { status: options.badToken ? 401 : 200 }) : Response.json({ userId: customerLine }); } });
  const request = (body = { bookingId }, authenticated = true) => new Request('https://example.test/api/notify/booking', { method: 'POST', headers: authenticated ? { Authorization: 'Bearer dummy-liff-token' } : {}, body: JSON.stringify(body) });
  return { post: exports.notifyBookingRequest, request, sent, requests, reads };
}
test('LINE notification rejects unauthenticated request without provider or DB access', async () => { const f = fixture(); assert.equal((await f.post(f.request({ bookingId }, false))).status, 401); assert.equal(f.requests.length + f.reads.length + f.sent.length, 0); });
test('LINE notification is disabled until explicitly enabled', async () => { const f = fixture({ disabled: true }); assert.equal((await f.post(f.request())).status, 503); assert.equal(f.sent.length + f.requests.length, 0); });
test('LINE notification rejects arbitrary recipient and message fields', async () => { const f = fixture(); assert.equal((await f.post(f.request({ bookingId, lineUserId: stylistLine, customerName: 'spoof' }))).status, 400); assert.equal(f.sent.length + f.requests.length, 0); });
for (const mode of ['badToken', 'wrongChannel', 'expired']) test(`LINE notification rejects ${mode}`, async () => { const f = fixture({ [mode]: true }); assert.equal((await f.post(f.request())).status, 401); assert.equal(f.sent.length + f.reads.length, 0); });
test('LINE notification denies another customer booking', async () => { const f = fixture({ otherOwner: true }); assert.equal((await f.post(f.request())).status, 404); assert.equal(f.sent.length, 0); assert.equal(f.reads.includes('stylists'), false); });
test('LINE notification rejects stale and non-pending booking requests', async () => { for (const booking of [{ created_at: new Date(Date.now()-601000).toISOString() }, { status: 'cancelled' }, { source: 'proxy' }]) { const f = fixture({ booking }); assert.equal((await f.post(f.request())).status, 409); assert.equal(f.sent.length, 0); } });
test('LINE notification uses database recipient/content and a stable replay key', async () => { const f = fixture(); for (let i = 0; i < 2; i++) assert.equal((await f.post(f.request())).status, 200); const [payload, retryKey] = f.sent[0]; assert.equal(payload.to, stylistLine); for(const content of ['DB顧客','10月1日','10:00','DBカット','5,000','DB備考','https://lino-salon.app/admin'])assert.ok(payload.messages[0].text.includes(content)); assert.equal(retryKey, bookingId); assert.equal(f.sent[1][1], retryKey); assert.equal(f.requests[1].init.headers.Authorization, 'Bearer dummy-liff-token'); });
test('LINE provider failure does not leak SDK details', async () => { const f = fixture({ pushFailure: true }); const response = await f.post(f.request()); assert.equal(response.status, 503); assert.equal((await response.text()).includes('sensitive'), false); });

test('LINE already accepted replay returns success without retrying', async () => { const f = fixture({ alreadyAccepted: true }); assert.equal((await f.post(f.request())).status, 200); assert.equal(f.sent.length, 1); });

test('long notification keeps dashboard link and stays within LINE text limit',async()=>{const f=fixture({booking:{menu_note:'長い備考🙂'.repeat(1500)}});assert.equal((await f.post(f.request())).status,200);const text=f.sent[0][0].messages[0].text;assert.ok(text.length<=5000);assert.ok(text.endsWith('https://lino-salon.app/admin'));assert.match(text,/続きは管理画面/);});
test('invalid stored booking detail never sends a message',async()=>{const f=fixture({booking:{total_price:-1}});assert.equal((await f.post(f.request())).status,503);assert.equal(f.sent.length,0);});
