import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';

// Webhookの処理には管理者権限が必要なため、Service Role Keyを使用する
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('Stripe-Signature') as string;

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error: any) {
    console.error('Webhook signature verification failed:', error.message);
    return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 });
  }

  const session = event.data.object as any;

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const subscription: any = await stripe.subscriptions.retrieve(session.subscription);
        const stylistId = session.metadata.stylistId;

        // DBにサブスクリプションを記録
        await supabaseAdmin.from('subscriptions').upsert({
          stylist_id: stylistId,
          status: subscription.status,
          plan_id: subscription.items.data[0].price.id,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
        });
        break;
      }
      
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        
        // Stripe Customer IDからスタイリストを特定
        const { data: stylist } = await supabaseAdmin
          .from('stylists')
          .select('id')
          .eq('payment_customer_id', subscription.customer)
          .single();

        if (stylist) {
          await supabaseAdmin.from('subscriptions').upsert({
            stylist_id: stylist.id,
            status: subscription.status,
            plan_id: subscription.items.data[0].price.id,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
          });
        }
        break;
      }
      
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return new NextResponse('Webhook handled successfully', { status: 200 });
  } catch (error: any) {
    console.error('Error handling webhook event:', error);
    return new NextResponse('Webhook handler failed', { status: 500 });
  }
}
