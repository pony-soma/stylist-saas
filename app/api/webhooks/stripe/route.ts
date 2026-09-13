import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { paymentVerifiedStatus } from '@/lib/billing-status';
import { getStripe } from '@/lib/stripe';
import { acquireBillingLock, billingAdmin, getBillingAccount, releaseBillingLock, saveBillingAccount } from '@/lib/billing';

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new NextResponse('Webhook configuration missing', { status: 503 });
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(await request.text(), request.headers.get('stripe-signature') ?? '', secret);
  } catch { return new NextResponse('Invalid webhook signature', { status: 400 }); }
  let userId: string | undefined;
  let lock: string | null = null;
  try {
    let subscriptionId: string | undefined;
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode !== 'subscription') return NextResponse.json({ received: true });
      subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    } else if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed'].includes(event.type)) {
      subscriptionId = (event.data.object as Stripe.Subscription).id;
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed' || event.type === 'invoice.finalization_failed') {
      const invoice = await getStripe().invoices.retrieve(event.data.object.id);
      const subscription = invoice.parent?.subscription_details?.subscription;
      subscriptionId = typeof subscription === 'string' ? subscription : subscription?.id;
      if (!subscriptionId) return NextResponse.json({ received: true });
    } else {
      return NextResponse.json({ received: true });
    }
    if (!subscriptionId) throw new Error('Subscription missing');
    const stripe = getStripe();
    const initial = await stripe.subscriptions.retrieve(subscriptionId);
    const customerId = typeof initial.customer === 'string' ? initial.customer : initial.customer.id;
    const { data: mapping, error } = await billingAdmin().from('billing_accounts').select('stylist_id').eq('stripe_customer_id', customerId).maybeSingle();
    if (error) throw new Error('Customer mapping read failed');
    if (!mapping) {
      // Unrelated Stripe products are ignored. LiNo subscriptions require operator
      // reconciliation or retry; never derive a trusted mapping from the public stylists table.
      if (initial.metadata.stylistId || (event.type === 'checkout.session.completed' && event.data.object.metadata?.stylistId)) throw new Error('LiNo customer mapping missing');
      return NextResponse.json({ received: true });
    }
    userId = mapping.stylist_id;
    lock = await acquireBillingLock(userId!);
    if (!lock) return new NextResponse('Billing busy; retry', { status: 503 });
    const account = await getBillingAccount(userId!);
    if (!account) throw new Error('Billing account missing');
    if (account.is_master) return NextResponse.json({ received: true });
    // Fetch after acquiring the shared lock. Do not apply the stale event snapshot:
    // Stripe retries and delivers events in arbitrary order.
    let subscription: Stripe.Subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const live: Stripe.Subscription[] = [];
    for await (const candidate of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
      if (!['canceled', 'incomplete_expired'].includes(candidate.status)) live.push(candidate);
    }
    if (live.length > 1) throw new Error('Multiple subscriptions need reconciliation');
    if (live.length === 1) subscription = live[0];
    else if (account.stripe_subscription_id && account.stripe_subscription_id !== subscription.id) {
      const previous = await stripe.subscriptions.retrieve(account.stripe_subscription_id);
      if (previous.created > subscription.created) subscription = previous;
    }
    const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id;
    const invoice = invoiceId ? await stripe.invoices.retrieve(invoiceId) : null;
    // 'active' can survive invoice finalization failures. Only grant a paid period
    // once Stripe confirms the latest invoice was paid (including a zero invoice).
    const item = subscription.items.data[0];
    let paidLineEnd = 0;
    if (subscription.status === 'active' && invoice?.status === 'paid') {
      // A paid prior invoice must not grant the newly advanced renewal period.
      for await (const line of stripe.invoices.listLineItems(invoice.id, { limit: 100 })) {
        if (line.parent?.subscription_item_details?.subscription_item === item?.id) paidLineEnd = Math.max(paidLineEnd, line.period.end);
      }
    }
    const verifiedStatus = paymentVerifiedStatus(subscription.status, invoice?.status ?? null, paidLineEnd, item?.current_period_end);
    if (subscription.items.data.length !== 1 || item?.price.id !== process.env.STRIPE_PRO_PLAN_ID) throw new Error('Unexpected subscription price');
    const periodEnd = subscription.status === 'trialing' ? subscription.trial_end : item.current_period_end;
    if (!periodEnd) throw new Error('Subscription period missing');
    // Flexible billing's portal sets cancel_at while leaving cancel_at_period_end false.
    // Store whether renewal at this access boundary is canceled, and never grant
    // access past an earlier cancellation or extend access to a later one.
    const cancelAt = subscription.cancel_at;
    const cancelsWithinPeriod = cancelAt != null && cancelAt <= periodEnd;
    const end = cancelsWithinPeriod ? cancelAt : periodEnd;
    await saveBillingAccount(userId!, {
      stripe_subscription_id: subscription.id, stripe_status: verifiedStatus,
      period_end: new Date(end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end || cancelsWithinPeriod,
      trial_started_at: account.trial_started_at ?? (subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null),
      trial_ended_at: account.trial_ended_at ?? (subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null),
      checkout_session_id: null, checkout_attempt: null, checkout_expires_at: null, checkout_trial: null,
    }, lock);
    return NextResponse.json({ received: true });
  } catch {
    console.error('Billing webhook processing failed', { eventId: event.id, eventType: event.type });
    return new NextResponse('Webhook persistence failed; retry', { status: 503 });
  } finally {
    if (userId && lock) await releaseBillingLock(userId, lock).catch(() => console.error('Billing lock release failed'));
  }
}
