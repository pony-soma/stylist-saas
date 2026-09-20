import { createClient } from '@supabase/supabase-js';
import { resolveBillingStatus } from './billing-status';
import type { BillingRecord } from './billing-status';
export type { BillingStatus } from './billing-status';
export type BillingAccount = BillingRecord & {
  stylist_id: string; stripe_customer_id: string | null; stripe_subscription_id: string | null;
  checkout_session_id: string | null; checkout_attempt: string | null; checkout_expires_at: string | null;
  checkout_trial: boolean | null; trial_ended_at: string | null;
};
export function billingAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Billing database configuration missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function getBillingAccount(userId: string): Promise<BillingAccount | null> {
  const { data, error } = await billingAdmin().from('billing_accounts').select('*').eq('stylist_id', userId).maybeSingle();
  if (error) throw new Error('Billing account read failed');
  return data;
}
export async function getBillingStatus(userId: string) { return resolveBillingStatus(await getBillingAccount(userId)); }
export function billingOrigin() {
  const value = process.env.NEXT_PUBLIC_BASE_URL;
  if (!value) throw new Error('NEXT_PUBLIC_BASE_URL is missing');
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) throw new Error('Invalid application origin');
  return url.origin;
}
export function assertBillingOrigin(request: Request) {
  if (request.headers.get('origin') !== billingOrigin()) throw new Error('Invalid request origin');
}
export async function saveBillingAccount(userId: string, values: Record<string, unknown>, lockToken?: string) {
  let query = billingAdmin().from('billing_accounts').update({ ...values, updated_at: new Date().toISOString() }).eq('stylist_id', userId);
  if (lockToken) query = query.eq('lock_token', lockToken).gt('lock_until', new Date().toISOString());
  const { data, error } = await query.select('stylist_id').single();
  if (error || !data) throw new Error('Billing account save failed');
}
export async function acquireBillingLock(userId: string) {
  const { data, error } = await billingAdmin().rpc('acquire_billing_lock', { account_id: userId });
  if (error) throw new Error('Billing lock failed');
  return data as string | null;
}
export async function releaseBillingLock(userId: string, token: string) {
  const { error } = await billingAdmin().from('billing_accounts').update({ lock_token: null, lock_until: null }).eq('stylist_id', userId).eq('lock_token', token);
  if (error) throw new Error('Billing lock release failed');
}
