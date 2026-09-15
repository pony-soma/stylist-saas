import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { assertBillingOrigin, billingOrigin, getBillingAccount } from '@/lib/billing';
import { getStripe } from '@/lib/stripe';
export async function POST(request: Request) {
  try { assertBillingOrigin(request); } catch { return NextResponse.json({ error: 'リクエストを確認できません。' }, { status: 403 }); }
  try {
    const { data: { user }, error } = await createClient().auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });
    const account = await getBillingAccount(user.id);
    if (!account?.stripe_customer_id) return NextResponse.json({ error: '管理できる契約がありません。' }, { status: 409 });
    const configuration = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
    if (!configuration) throw new Error('Portal configuration missing');
    const settings = await getStripe().billingPortal.configurations.retrieve(configuration);
    if (!settings.active || !settings.features.subscription_cancel.enabled || settings.features.subscription_cancel.mode !== 'at_period_end') throw new Error('Portal must cancel at period end');
    const portal = await getStripe().billingPortal.sessions.create({ customer: account.stripe_customer_id, configuration, return_url: `${billingOrigin()}/billing?portal_return=true` });
    return NextResponse.json({ url: portal.url });
  } catch { return NextResponse.json({ error: '契約管理画面を開けませんでした。' }, { status: 503 }); }
}
