'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { checkEnvironment } = require('../scripts/check-release-env.cjs');

function fixture(target = 'staging') {
  const prod = target === 'production';
  return {
    NEXT_PUBLIC_SUPABASE_URL: `https://${prod ? 'pprlqowossudjvtgkfir' : 'kmwvfotrvhaddriebxur'}.supabase.co`,
    NEXT_PUBLIC_BASE_URL: prod ? 'https://lino-salon.app' : 'https://lino-staging.vercel.app',
    NEXT_PUBLIC_APP_URL: prod ? 'https://lino-salon.app' : 'https://lino-staging.vercel.app',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_FAKE', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_FAKE',
    STRIPE_SECRET_KEY: prod ? 'rk_live_FAKE' : 'sk_test_FAKE', STRIPE_PRO_PLAN_ID: 'price_FAKE',
    STRIPE_BILLING_PORTAL_CONFIGURATION_ID: 'bpc_FAKE', STRIPE_WEBHOOK_SECRET: 'whsec_FAKE',
    NEXT_PUBLIC_LIFF_ID: 'FAKE', NEXT_PUBLIC_LINE_FRIEND_URL: 'https://lin.ee/FAKE', LINE_LOGIN_CHANNEL_ID: 'FAKE', LINE_LOGIN_CHANNEL_SECRET: 'FAKE', LINE_CHANNEL_SECRET: 'FAKE', LINE_CHANNEL_ACCESS_TOKEN: 'FAKE',
    LINE_BOOKING_NOTIFICATIONS_ENABLED: 'true', LINE_BOOKING_CANCELLATION_ENABLED: 'true',
  };
}
test('correct target-specific shape including restricted live keys passes local checks', () => {
  for (const target of ['staging', 'production']) assert.equal(checkEnvironment(target, fixture(target)).passed, true);
});
test('disabled LINE operations prevent full release readiness', () => {
  const env = fixture();
  delete env.LINE_BOOKING_NOTIFICATIONS_ENABLED;
  delete env.LINE_BOOKING_CANCELLATION_ENABLED;
  const result = checkEnvironment('staging', env);
  assert.equal(result.passed, false);
  assert.equal(result.incomplete.length, 2);
});
test('mixing production and staging configuration fails without revealing values', () => {
  const env = fixture('production');
  Object.assign(env, { NEXT_PUBLIC_SUPABASE_URL: fixture().NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_APP_URL: fixture().NEXT_PUBLIC_APP_URL, STRIPE_SECRET_KEY: 'sk_test_DO_NOT_PRINT' });
  const result = checkEnvironment('production', env);
  assert.equal(result.errors.length, 3);
  assert.equal(result.passed, false);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_PRINT/);
});
test('credential-bearing URLs and public secret keys fail', () => {
  const env = fixture();
  env.NEXT_PUBLIC_BASE_URL = 'https://user:password@lino-staging.vercel.app';
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(checkEnvironment('staging', env).passed, false);
});
test('missing Stripe webhook and unfinished LINE are release blockers', () => {
  const env = fixture();
  delete env.STRIPE_WEBHOOK_SECRET;
  delete env.LINE_CHANNEL_ACCESS_TOKEN;
  const result = checkEnvironment('staging', env);
  assert.deepEqual(result.errors, ['STRIPE_WEBHOOK_SECRET: missing']);
  assert.deepEqual(result.incomplete, ['LINE_CHANNEL_ACCESS_TOKEN: not configured']);
  assert.equal(result.passed, false);
});
test('legacy JWT public service role and wrong project are rejected', () => {
  const env = fixture();
  const jwt = claims => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt({ role: 'service_role', ref: 'kmwvfotrvhaddriebxur' });
  env.SUPABASE_SERVICE_ROLE_KEY = jwt({ role: 'service_role', ref: 'pprlqowossudjvtgkfir' });
  assert.equal(checkEnvironment('staging', env).errors.length, 2);
});
test('LINE friend URL rejects known production destination in staging and lookalike hosts', () => {
  for (const url of ['https://lin.ee/PLovQIR', 'https://lin.ee.attacker.example/FAKE', 'http://lin.ee/FAKE']) {
    assert.equal(checkEnvironment('staging', { ...fixture(), NEXT_PUBLIC_LINE_FRIEND_URL: url }).passed, false);
  }
  assert.equal(checkEnvironment('production', { ...fixture('production'), NEXT_PUBLIC_LINE_FRIEND_URL: 'https://lin.ee/PLovQIR' }).passed, true);
});
test('CLI requires explicit target and never echoes invalid values', () => {
  const script = path.join(__dirname, '../scripts/check-release-env.cjs');
  const missing = spawnSync(process.execPath, [script], { encoding: 'utf8', env: {} });
  assert.equal(missing.status, 2);
  const env = { ...fixture(), STRIPE_SECRET_KEY: 'sensitive-invalid-value' };
  const result = spawnSync(process.execPath, [script, '--target', 'staging'], { encoding: 'utf8', env });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /sensitive-invalid-value/);
});
