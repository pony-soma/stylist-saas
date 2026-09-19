export type BillingStatus = {
  status: 'master' | 'trialing' | 'active' | 'expired' | 'pending';
  canCheckout: boolean;
  trialEligible: boolean;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};
export type BillingRecord = {
  is_master: boolean;
  stripe_status: string | null;
  period_end: string | null;
  cancel_at_period_end: boolean;
  trial_started_at: string | null;
};
export function resolveBillingStatus(row: BillingRecord | null, now = Date.now()): BillingStatus {
  const result: BillingStatus = { status: 'pending', canCheckout: !row?.stripe_status || ['canceled', 'incomplete_expired'].includes(row.stripe_status), trialEligible: !row?.trial_started_at, periodEnd: row?.period_end ?? null, cancelAtPeriodEnd: row?.cancel_at_period_end ?? false };
  if (!row) return result;
  if (row.is_master) return { ...result, status: 'master', canCheckout: false, trialEligible: false, periodEnd: null, cancelAtPeriodEnd: false };
  if ((row.stripe_status === 'active' || row.stripe_status === 'trialing') && row.period_end && Date.parse(row.period_end) > now) {
    return { ...result, status: row.stripe_status };
  }
  return { ...result, status: row.stripe_status || row.trial_started_at ? 'expired' : 'pending' };
}

export function paymentVerifiedStatus(status: string, invoiceStatus: string | null, paidLineEnd = 0, requiredPeriodEnd = 0): string {
  return status === 'active' && (invoiceStatus !== 'paid' || !requiredPeriodEnd || paidLineEnd < requiredPeriodEnd) ? 'past_due' : status;
}
