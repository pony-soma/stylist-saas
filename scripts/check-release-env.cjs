#!/usr/bin/env node
'use strict';

// Read-only local configuration checks. Values, credentials and remote responses
// are never printed. This does not authorize deployment or verify live resources.
const targets = {
  staging: { origin: 'https://lino-staging.vercel.app', supabase: 'https://kmwvfotrvhaddriebxur.supabase.co', mode: 'test' },
  production: { origin: 'https://lino-salon.app', supabase: 'https://pprlqowossudjvtgkfir.supabase.co', mode: 'live' },
};
const lineNames = ['NEXT_PUBLIC_LIFF_ID', 'NEXT_PUBLIC_LINE_FRIEND_URL', 'LINE_LOGIN_CHANNEL_ID', 'LINE_LOGIN_CHANNEL_SECRET', 'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'];

function checkEnvironment(target, env) {
  const spec = targets[target];
  if (!spec) throw new Error('Target must be staging or production');
  const errors = [];
  const incomplete = [];
  const value = name => typeof env[name] === 'string' ? env[name].trim() : '';
  function required(name) {
    const text = value(name);
    if (!text) errors.push(`${name}: missing`);
    return text;
  }
  function origin(name, expected) {
    const text = required(name);
    if (!text) return;
    try {
      const url = new URL(text);
      if (url.origin !== expected || url.pathname !== '/' || url.search || url.hash || url.username || url.password) errors.push(`${name}: wrong target or invalid origin`);
    } catch { errors.push(`${name}: invalid URL`); }
  }
  origin('NEXT_PUBLIC_SUPABASE_URL', spec.supabase);
  origin('NEXT_PUBLIC_BASE_URL', spec.origin);
  origin('NEXT_PUBLIC_APP_URL', spec.origin);
  const publicKey = required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  if (publicKey && (publicKey.startsWith('sb_secret_') || publicKey === serviceKey)) errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY: secret key exposed or keys identical');
  // Legacy JWT claims are inspected only to detect obvious configuration errors;
  // this is not signature verification. Opaque sb_* keys need remote validation.
  for (const [name, key, role] of [['NEXT_PUBLIC_SUPABASE_ANON_KEY', publicKey, 'anon'], ['SUPABASE_SERVICE_ROLE_KEY', serviceKey, 'service_role']]) {
    if (!key) continue;
    const opaquePrefix = role === 'anon' ? 'sb_publishable_' : 'sb_secret_';
    if (key.startsWith(opaquePrefix) && key.length > opaquePrefix.length) continue;
    try {
      const parts = key.split('.');
      if (parts.length !== 3) throw new Error();
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (claims.role !== role || claims.ref !== new URL(spec.supabase).hostname.split('.')[0]) throw new Error();
    } catch { errors.push(`${name}: invalid key type or legacy JWT target/role`); }
  }
  const stripeKey = required('STRIPE_SECRET_KEY');
  if (stripeKey && !new RegExp(`^(sk|rk)_${spec.mode}_[A-Za-z0-9]+$`).test(stripeKey)) errors.push('STRIPE_SECRET_KEY: wrong mode or invalid secret/restricted key');
  for (const [name, prefix] of [['STRIPE_PRO_PLAN_ID', 'price_'], ['STRIPE_BILLING_PORTAL_CONFIGURATION_ID', 'bpc_'], ['STRIPE_WEBHOOK_SECRET', 'whsec_']]) {
    const text = required(name);
    if (text && !new RegExp(`^${prefix}[A-Za-z0-9]+$`).test(text)) errors.push(`${name}: invalid format`);
  }
  for (const name of lineNames) if (!value(name)) incomplete.push(`${name}: not configured`);
  for (const name of ['LINE_BOOKING_NOTIFICATIONS_ENABLED', 'LINE_BOOKING_CANCELLATION_ENABLED']) {
    if (value(name) !== 'true') incomplete.push(`${name}: awaiting protected reservation flow verification`);
  }
  const friendUrl = value('NEXT_PUBLIC_LINE_FRIEND_URL');
  if (friendUrl) {
    try {
      const url = new URL(friendUrl);
      const officialPath = (url.hostname === 'lin.ee' && /^\/[A-Za-z0-9]+\/?$/.test(url.pathname)) || (url.hostname === 'line.me' && /^\/R\/ti\/p\/.+/.test(url.pathname));
      if (url.protocol !== 'https:' || !officialPath || url.port || url.username || url.password || url.search || url.hash) throw new Error();
      if (target === 'staging' && url.hostname === 'lin.ee' && url.pathname.replace(/\/$/, '') === '/PLovQIR') errors.push('NEXT_PUBLIC_LINE_FRIEND_URL: known production LINE destination');
    } catch { errors.push('NEXT_PUBLIC_LINE_FRIEND_URL: invalid official LINE friend URL'); }
  }
  return { target, errors, incomplete, passed: !errors.length && !incomplete.length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--target' || !Object.hasOwn(targets, args[1])) {
    console.error('Usage: node scripts/check-release-env.cjs --target staging|production');
    process.exitCode = 2;
  } else {
    const result = checkEnvironment(args[1], process.env);
    console.log(`Environment preflight: ${result.target}`);
    for (const message of result.errors) console.error(`ERROR ${message}`);
    for (const message of result.incomplete) console.error(`INCOMPLETE ${message}`);
    console.log(result.passed ? 'Local configuration checks passed.' : 'Release readiness checks incomplete.');
    console.log('Remote account ownership, opaque key targets, Stripe resources, webhook delivery, OAuth, LINE and RLS still require verification. No deployment or authorization performed.');
    process.exitCode = result.passed ? 0 : 1;
  }
}

module.exports = { checkEnvironment };
