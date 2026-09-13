const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => { if (!(id in mocks)) throw Error(`Unexpected import ${id}`); return mocks[id]; }, process: { env: { STRIPE_PRO_PLAN_ID: 'price_expected', STRIPE_WEBHOOK_SECRET: 'whsec_test' } }, console: { error() {} }, Date, URL, Response });
  return exports;
}
function fixture(overrides = {}) {
  const calls = [];
  let account = { is_master: false, stripe_status: null, stripe_customer_id: 'cus_owned', trial_started_at: null, checkout_session_id: null, checkout_attempt: 'attempt', checkout_expires_at: new Date(Date.now()+3600000).toISOString(), checkout_trial: true, ...overrides.account };
  const query = { upsert: () => Promise.resolve({ error: null }), select: () => query, eq: () => query, gt: () => query, update: () => query, maybeSingle: async () => ({ data: { stylist_id: 'user' }, error: overrides.dbError || null }) };
  const billing = {
    assertBillingOrigin() {}, billingOrigin: () => 'https://example.test', billingAdmin: () => ({ from: () => query }),
    acquireBillingLock: async () => 'lock', releaseBillingLock: async () => calls.push('release'),
    getBillingAccount: async () => account, saveBillingAccount: async (_, update) => { if (overrides.saveError) throw Error('DB unavailable'); account = { ...account, ...update }; calls.push(update); },
  };
  const stripe = {
    prices: { retrieve: async () => ({ active: true, currency: 'jpy', unit_amount: 1980, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }) },
    subscriptions: { list: async function* () {}, retrieve: async () => ({ id: 'sub', customer: 'cus_owned', metadata: { stylistId: 'user' }, status: 'trialing', trial_end: 1900000000, trial_start: 1890000000, items: { data: [{ price: { id: 'price_expected' }, current_period_end: 1900000000 }] }, cancel_at_period_end: false, cancel_at: null, ...overrides.subscription }) },
    checkout: { sessions: { list: async function* () {}, retrieve: async () => ({ status: 'open', url: 'https://checkout.stripe.test/existing' }), create: async (params, opts) => { calls.push({ params, opts }); return { id: 'cs_new', url: 'https://checkout.stripe.test/new' }; } } },
    webhooks: { constructEvent: () => { if (overrides.badSignature) throw Error('bad'); return { id: 'evt', type: 'customer.subscription.updated', data: { object: { id: 'sub' } } }; } },
    invoices: { retrieve: async () => ({ status: 'paid' }) },
  };
  const mocks = { crypto: { randomUUID: () => 'new-attempt' }, 'next/server': { NextResponse: class extends Response { static json(value, init) { return new Response(JSON.stringify(value), init); } } }, '@/lib/stripe': { getStripe: () => stripe }, '@/lib/billing': billing, '@/lib/billing-status': { paymentVerifiedStatus: (s, i) => s === 'active' && i !== 'paid' ? 'past_due' : s }, '@/lib/supabase/server': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: overrides.unauthorized ? null : { id: 'user', email: 'test@example.test' } }, error: null }) } }) } };
  return { calls, stripe, mocks };
}
const request = body => new Request('https://example.test/api/create-checkout-session', { method: 'POST', body: JSON.stringify(body) });
test('checkout rejects unauthenticated users', async () => { const f=fixture({unauthorized:true}); assert.equal((await load('app/api/create-checkout-session/route.ts',f.mocks).POST(request({consent:true}))).status,401); });
test('checkout requires explicit consent', async () => { const f=fixture(); assert.equal((await load('app/api/create-checkout-session/route.ts',f.mocks).POST(request({planId:'attacker'}))).status,400); });
test('master never creates checkout', async () => { const f=fixture({account:{is_master:true}}); assert.equal((await load('app/api/create-checkout-session/route.ts',f.mocks).POST(request({consent:true}))).status,409); assert.equal(f.calls.some(c=>c.params),false); });
test('checkout ignores client price and requires card plus first trial', async () => { const f=fixture(); assert.equal((await load('app/api/create-checkout-session/route.ts',f.mocks).POST(request({consent:true,planId:'attacker'}))).status,200); const call=f.calls.find(c=>c.params); assert.equal(call.params.line_items[0].price,'price_expected'); assert.equal(call.params.payment_method_collection,'always'); assert.equal(call.params.payment_method_types[0],'card'); assert.equal(call.params.subscription_data.trial_period_days,14); assert.equal(call.opts.idempotencyKey,'lino-checkout-attempt'); });
test('open session is reused without duplicate creation', async () => { const f=fixture({account:{checkout_session_id:'cs_old'}}); const r=await load('app/api/create-checkout-session/route.ts',f.mocks).POST(request({consent:true})); assert.equal((await r.json()).url,'https://checkout.stripe.test/existing'); assert.equal(f.calls.some(c=>c.params),false); });
test('webhook rejects invalid signature', async () => { const f=fixture({badSignature:true}); assert.equal((await load('app/api/webhooks/stripe/route.ts',f.mocks).POST(request({}))).status,400); });
test('webhook database failure requests a retry', async () => { const f=fixture({saveError:true}); assert.equal((await load('app/api/webhooks/stripe/route.ts',f.mocks).POST(request({}))).status,503); });
test('webhook uses retrieved current subscription rather than stale event object', async () => { const f=fixture(); assert.equal((await load('app/api/webhooks/stripe/route.ts',f.mocks).POST(request({}))).status,200); const saved=f.calls.find(c=>c.stripe_status); assert.equal(saved.stripe_status,'trialing'); assert.equal(saved.checkout_attempt,null); });

test('flexible portal cancellation is reflected without the legacy flag', async () => {
  const f = fixture({ subscription: { cancel_at: 1900000000, cancel_at_period_end: false } });
  assert.equal((await load('app/api/webhooks/stripe/route.ts', f.mocks).POST(request({}))).status, 200);
  const saved = f.calls.find(c => c.stripe_status);
  assert.equal(saved.cancel_at_period_end, true);
  assert.equal(saved.stripe_status, 'trialing');
  assert.equal(saved.period_end, new Date(1900000000 * 1000).toISOString());
});
test('legacy period-end cancellation remains supported', async () => {
  const f = fixture({ subscription: { cancel_at_period_end: true } });
  assert.equal((await load('app/api/webhooks/stripe/route.ts', f.mocks).POST(request({}))).status, 200);
  assert.equal(f.calls.find(c => c.stripe_status).cancel_at_period_end, true);
});
test('earlier cancellation limits access even when Stripe preserves trial_end', async () => {
  const f = fixture({ subscription: { cancel_at: 1895000000 } });
  assert.equal((await load('app/api/webhooks/stripe/route.ts', f.mocks).POST(request({}))).status, 200);
  const saved = f.calls.find(c => c.stripe_status);
  assert.equal(saved.period_end, new Date(1895000000 * 1000).toISOString());
  assert.equal(saved.trial_ended_at, new Date(1900000000 * 1000).toISOString());
  assert.equal(saved.cancel_at_period_end, true);
});
test('future cancellation cannot extend this period or suppress an intervening renewal', async () => {
  const f = fixture({ subscription: { cancel_at: 1905000000 } });
  assert.equal((await load('app/api/webhooks/stripe/route.ts', f.mocks).POST(request({}))).status, 200);
  const saved = f.calls.find(c => c.stripe_status);
  assert.equal(saved.period_end, new Date(1900000000 * 1000).toISOString());
  assert.equal(saved.cancel_at_period_end, false);
});
test('resuming subscription clears stored cancellation from current Stripe state', async () => {
  const f = fixture({ account: { cancel_at_period_end: true }, subscription: { cancel_at: null, cancel_at_period_end: false } });
  assert.equal((await load('app/api/webhooks/stripe/route.ts', f.mocks).POST(request({}))).status, 200);
  assert.equal(f.calls.find(c => c.stripe_status).cancel_at_period_end, false);
});
