import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { billingAdmin } from '@/lib/billing';

// Signature proves LINE sent the event; the customer lookup separately proves
// the sender owns the booking. A valid postback is not authorization by itself.
export async function POST(req: Request) {
  // Enable only after customer identities and booking ownership are protected
  // by the reservation API/RLS. Legacy permissive tables are not trusted.
  if (process.env.LINE_BOOKING_CANCELLATION_ENABLED !== 'true') return NextResponse.json({ error: 'LINE cancellation unavailable' }, { status: 503 });
  const secret = process.env.LINE_CHANNEL_SECRET;
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!secret || !token) return NextResponse.json({ error: 'LINE configuration missing' }, { status: 503 });
  try {
    const text = await req.text();
    const signature = req.headers.get('x-line-signature') || '';
    const expected = createHmac('sha256', secret).update(text).digest('base64');
    const supplied = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    let body;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid event' }, { status: 400 }); }
    if (!body || !Array.isArray(body.events)) return NextResponse.json({ error: 'Invalid events' }, { status: 400 });
    for (const event of body.events) {
      // Only a direct user conversation has the intended cancellation contract.
      if (event?.type !== 'postback' || event.source?.type !== 'user' || typeof event.source.userId !== 'string' || !/^U[0-9a-f]{32}$/i.test(event.source.userId) || typeof event.postback?.data !== 'string') continue;
      const params = new URLSearchParams(event.postback.data);
      const bookingId = params.get('bookingId');
      if (params.get('action') !== 'cancel' || !bookingId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) continue;
      const db = billingAdmin();
      const { data: customer, error: customerError } = await db.from('customers').select('id').eq('line_user_id', event.source.userId).maybeSingle();
      if (customerError) throw new Error('Customer read failed');
      if (!customer) continue;
      // Scope both read and mutation. Never reveal whether another user's ID exists.
      const { data: booking, error: bookingError } = await db.from('bookings').select('id,status').eq('id', bookingId).eq('customer_id', customer.id).maybeSingle();
      if (bookingError) throw new Error('Booking read failed');
      if (!booking || !['confirmed', 'cancelled'].includes(booking.status)) continue;
      if (booking.status === 'confirmed') {
        const { data: changed, error } = await db.from('bookings')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', bookingId).eq('customer_id', customer.id).eq('status', 'confirmed')
          .select('id').maybeSingle();
        if (error) throw new Error('Cancellation failed');
        if (!changed) continue;
      }
      if (typeof event.replyToken !== 'string' || !event.replyToken) continue;
      // Cancellation is committed independently of best-effort reply delivery.
      // Do not send a second paid push or undo a cancellation if LINE reply fails.
      try {
        const reply = await fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ replyToken: event.replyToken, messages: [{ type: 'text', text: 'ご予約のキャンセルを受け付けました。またのご来店をお待ちしております。' }] }),
        });
        if (!reply.ok) console.error('LINE cancellation reply failed');
      } catch { console.error('LINE cancellation reply unavailable'); }
    }
    return NextResponse.json({ status: 'success' });
  } catch {
    console.error('LINE cancellation persistence failed');
    return NextResponse.json({ error: 'Processing failed; retry' }, { status: 503 });
  }
}
