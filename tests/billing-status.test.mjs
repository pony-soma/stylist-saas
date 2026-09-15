import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveBillingStatus, paymentVerifiedStatus } from '../lib/billing-status.ts';
const now = Date.parse('2026-09-12T00:00:00Z');
const base = { is_master: false, stripe_status: 'trialing', period_end: '2026-09-13T00:00:00Z', cancel_at_period_end: false, trial_started_at: '2026-08-30T00:00:00Z' };
test('new account has no access before card completion', () => { const s = resolveBillingStatus(null, now); assert.equal(s.status, 'pending'); assert.equal(s.canCheckout, true); assert.equal(s.trialEligible, true); });
test('master exemption does not depend on email or stale subscription date', () => { const s = resolveBillingStatus({ ...base, is_master: true, period_end: '2000-01-01' }, now); assert.equal(s.status, 'master'); assert.equal(s.canCheckout, false); });
test('trial expires at the exact boundary', () => { assert.equal(resolveBillingStatus({ ...base, period_end: new Date(now).toISOString() }, now).status, 'expired'); });
test('period-end cancellation retains the remaining trial', () => { const s = resolveBillingStatus({ ...base, cancel_at_period_end: true }, now); assert.equal(s.status, 'trialing'); assert.equal(s.cancelAtPeriodEnd, true); });
test('stale active status cannot grant permanent access', () => { assert.equal(resolveBillingStatus({ ...base, stripe_status: 'active', period_end: '2000-01-01' }, now).status, 'expired'); });
test('failed/paused/incomplete subscriptions cannot gain access or create duplicates', () => { for (const stripe_status of ['past_due', 'unpaid', 'paused', 'incomplete', 'migration_required']) { const s = resolveBillingStatus({ ...base, stripe_status }, now); assert.equal(s.status, 'expired'); assert.equal(s.canCheckout, false); } });
test('cancelled customers may resubscribe but never reset their trial', () => { const s = resolveBillingStatus({ ...base, stripe_status: 'canceled' }, now); assert.equal(s.status, 'expired'); assert.equal(s.canCheckout, true); assert.equal(s.trialEligible, false); });
test('invalid period fails closed', () => { assert.equal(resolveBillingStatus({ ...base, period_end: 'bad-date' }, now).status, 'expired'); });

test('active subscription with unpaid or unfinalized invoice is denied', () => { for (const invoice of [null, 'open', 'draft', 'void', 'uncollectible']) assert.equal(paymentVerifiedStatus('active', invoice), 'past_due'); assert.equal(paymentVerifiedStatus('active', 'paid', 200, 200), 'active'); assert.equal(paymentVerifiedStatus('trialing', 'paid'), 'trialing'); });

test('a paid invoice from the previous period cannot grant an unpaid renewal', () => { assert.equal(paymentVerifiedStatus('active', 'paid', 100, 200), 'past_due'); assert.equal(paymentVerifiedStatus('active', 'paid', 200, 200), 'active'); assert.equal(paymentVerifiedStatus('active', 'paid'), 'past_due'); });
