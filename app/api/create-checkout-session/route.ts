import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { planId } = await request.json();
    const userId = session.user.id;
    const userEmail = session.user.email;

    // 1. スタイリスト情報の取得
    const { data: stylist, error: stylistError } = await supabase
      .from('stylists')
      .select('payment_customer_id, name')
      .eq('id', userId)
      .single();

    if (stylistError || !stylist) {
      return new NextResponse('Stylist not found', { status: 404 });
    }

    let customerId = stylist.payment_customer_id;

    // 2. Stripe顧客が存在しない場合は作成
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        name: stylist.name,
        metadata: {
          stylistId: userId,
        },
      });
      customerId = customer.id;

      // DBを更新
      await supabase
        .from('stylists')
        .update({ payment_customer_id: customerId })
        .eq('id', userId);
    }

    // 3. Checkout Sessionの作成
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    
    // サブスクリプション作成用セッション
    const stripeSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: planId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/admin?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url: `${baseUrl}/admin?canceled=true`,
      metadata: {
        stylistId: userId,
      },
    });

    return NextResponse.json({ url: stripeSession.url });
  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
