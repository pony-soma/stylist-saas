import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';
import { acquireBillingLock, assertBillingOrigin, billingAdmin, billingOrigin, getBillingAccount, releaseBillingLock, saveBillingAccount } from '@/lib/billing';

export async function POST(request: Request) {
  try { assertBillingOrigin(request); } catch { return NextResponse.json({ error: 'リクエストを確認できません。' }, { status: 403 }); }
  let stage = 'authenticate';
  let userId: string | undefined;
  let lock: string | null = null;
  try {
    const { data: { user }, error } = await createClient().auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });
    userId = user.id;
    let input;
    try { input = await request.json(); } catch { return NextResponse.json({ error: '入力を確認してください。' }, { status: 400 }); }
    if (input?.consent !== true) return NextResponse.json({ error: '自動更新への同意が必要です。' }, { status: 400 });
    stage = 'billing_account_initialize';
    const admin = billingAdmin();
    const { error: insertError } = await admin.from('billing_accounts').upsert({ stylist_id: userId }, { onConflict: 'stylist_id', ignoreDuplicates: true });
    if (insertError) throw new Error('Account initialization failed');
    stage = 'billing_lock';
    lock = await acquireBillingLock(userId);
    if (!lock) return NextResponse.json({ error: '処理中です。少し待ってから再試行してください。' }, { status: 409 });
    const persist = (values: Record<string, unknown>) => saveBillingAccount(userId!, values, lock!);
    stage = 'billing_account_read';
    let account = await getBillingAccount(userId);
    if (!account) throw new Error('Account missing');
    if (account.is_master) return NextResponse.json({ error: 'このアカウントは無料で利用できます。' }, { status: 409 });
    if (account.stripe_status === 'migration_required') return NextResponse.json({ error: '既存契約の確認が必要です。運営へお問い合わせください。' }, { status: 409 });
    stage = 'stripe_client';
    const stripe = getStripe();
    const priceId = process.env.STRIPE_PRO_PLAN_ID;
    if (!priceId) throw new Error('Price missing');
    stage = 'stripe_price_read';
    const price = await stripe.prices.retrieve(priceId);
    stage = 'stripe_price_validate';
    if (!price.active || price.currency !== 'jpy' || price.unit_amount !== 1980 || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed') throw new Error('Unexpected price configuration');
    let customerId = account.stripe_customer_id;
    if (!customerId) {
      stage = 'stripe_customer_create';
      const customer = await stripe.customers.create({ email: user.email, metadata: { stylistId: userId } }, { idempotencyKey: `lino-customer-${userId}` });
      customerId = customer.id;
      stage = 'billing_customer_save';
      await persist({ stripe_customer_id: customerId });
    }
    stage = 'stripe_subscription_history';
    let trialUsed = !!account.trial_started_at;
    // Include canceled subscriptions so a historical trial cannot be claimed again.
    for await (const subscription of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
      if (!['canceled', 'incomplete_expired'].includes(subscription.status)) return NextResponse.json({ error: '契約が既にあります。契約管理画面をご利用ください。' }, { status: 409 });
      if (subscription.trial_start) {
        trialUsed = true;
        if (!account.trial_started_at) await persist({ trial_started_at: new Date(subscription.trial_start * 1000).toISOString() });
      }
    }
    stage = 'stripe_session_recovery';
    if (account.checkout_session_id) {
      const previous = await stripe.checkout.sessions.retrieve(account.checkout_session_id);
      if (previous.status === 'open' && previous.url) return NextResponse.json({ url: previous.url });
      if (previous.status === 'complete') return NextResponse.json({ error: '契約を反映中です。少し待ってから再読み込みしてください。' }, { status: 409 });
    }
    // Recover a session whose Stripe creation succeeded but whose DB save failed.
    // Do this before rotating the attempt, including the final 30 minutes of its life.
    if (account.checkout_attempt && !account.checkout_session_id) {
      for await (const previous of stripe.checkout.sessions.list({ customer: customerId, limit: 100 })) {
        if (previous.metadata?.checkoutAttempt !== account.checkout_attempt) continue;
        if (previous.status === 'open' && previous.url) {
          await persist({ checkout_session_id: previous.id });
          return NextResponse.json({ url: previous.url });
        }
        if (previous.status === 'complete') return NextResponse.json({ error: '契約を反映中です。少し待ってから再読み込みしてください。' }, { status: 409 });
      }
    }
    stage = 'billing_attempt_save';
    const now = Date.now();
    if (!account.checkout_attempt || !account.checkout_expires_at || Date.parse(account.checkout_expires_at) <= now + 30 * 60000) {
      await persist({ checkout_attempt: randomUUID(), checkout_expires_at: new Date(now + 12 * 3600000).toISOString(), checkout_session_id: null, checkout_trial: !trialUsed, consent_at: new Date(now).toISOString(), consent_version: 'card-trial-14d-monthly-1980-v1' });
      account = await getBillingAccount(userId);
    }
    if (!account?.checkout_attempt || !account.checkout_expires_at) throw new Error('Checkout attempt missing');
    // Renew the lease immediately before the charge-capable operation, fenced by token.
    stage = 'billing_lease_renew';
    const { data: renewed, error: renewError } = await admin.from('billing_accounts')
      .update({ lock_until: new Date(Date.now() + 120000).toISOString() })
      .eq('stylist_id', userId).eq('lock_token', lock).gt('lock_until', new Date().toISOString())
      .select('stylist_id').maybeSingle();
    if (renewError || !renewed) throw new Error('Billing lease lost');
    stage = 'stripe_session_create';
    const session = await stripe.checkout.sessions.create({
      customer: customerId, mode: 'subscription', payment_method_types: ['card'], payment_method_collection: 'always',
      line_items: [{ price: priceId, quantity: 1 }], expires_at: Math.floor(Date.parse(account.checkout_expires_at) / 1000),
      subscription_data: { metadata: { stylistId: userId }, ...(account.checkout_trial ? { trial_period_days: 14, trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } } } : {}) },
      metadata: { stylistId: userId, checkoutAttempt: account.checkout_attempt, consentVersion: 'card-trial-14d-monthly-1980-v1' },
      success_url: `${billingOrigin()}/billing?success=true`, cancel_url: `${billingOrigin()}/billing?canceled=true`,
    }, { idempotencyKey: `lino-checkout-${account.checkout_attempt}` });
    stage = 'billing_session_save';
    await persist({ checkout_session_id: session.id });
    if (!session.url) throw new Error('Checkout URL missing');
    return NextResponse.json({ url: session.url });
  } catch (error) {
    // Only static classifications are logged. Never log error messages, bodies,
    // headers, credentials, email addresses, or Stripe/Supabase response objects.
    const failure = error as { type?: unknown; code?: unknown; statusCode?: unknown } | null;
    const types = ['StripeAuthenticationError', 'StripePermissionError', 'StripeInvalidRequestError', 'StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'];
    const codes = ['resource_missing', 'api_key_expired', 'invalid_api_key', 'parameter_invalid_integer', 'parameter_missing', 'idempotency_key_in_use', 'rate_limit'];
    console.error('LiNo checkout failed', {
      stage,
      type: typeof failure?.type === 'string' && types.includes(failure.type) ? failure.type : 'ApplicationError',
      code: typeof failure?.code === 'string' && codes.includes(failure.code) ? failure.code : 'unclassified',
      status: typeof failure?.statusCode === 'number' && failure.statusCode >= 400 && failure.statusCode <= 599 ? failure.statusCode : null,
    });
    return NextResponse.json({ error: '決済画面を開けませんでした。時間をおいて再試行してください。' }, { status: 503 });
  } finally {
    if (userId && lock) await releaseBillingLock(userId, lock).catch(() => console.error('Billing lock release failed'));
  }
}
