import { NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import { billingAdmin } from '@/lib/billing';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lineId = /^U[0-9a-f]{32}$/i;

export async function POST(req: Request) {
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length > 4096) {
    return NextResponse.json({ error: 'LINE authentication required' }, { status: 401 });
  }
  // Keep disabled until verified customer/booking writes and ownership RLS are deployed.
  // Existing browser-supplied LINE IDs are not a trustworthy identity store.
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (process.env.LINE_BOOKING_NOTIFICATIONS_ENABLED !== 'true' || !channelId || !channelAccessToken) {
    return NextResponse.json({ error: 'LINE notification unavailable' }, { status: 503 });
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  // No caller-selected recipient or message content is accepted.
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => key !== 'bookingId') ||
      !('bookingId' in body) || typeof body.bookingId !== 'string' || !uuid.test(body.bookingId)) {
    return NextResponse.json({ error: 'Only bookingId is accepted' }, { status: 400 });
  }
  try {
    const token = authorization.slice(7);
    const verification = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`, {
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!verification.ok) return NextResponse.json({ error: 'Invalid LINE token' }, { status: 401 });
    const verified = await verification.json();
    if (verified.client_id !== channelId || typeof verified.expires_in !== 'number' || verified.expires_in <= 0) {
      return NextResponse.json({ error: 'Invalid LINE token' }, { status: 401 });
    }
    const profileResponse = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!profileResponse.ok) return NextResponse.json({ error: 'Invalid LINE token' }, { status: 401 });
    const profile = await profileResponse.json();
    if (typeof profile.userId !== 'string' || !lineId.test(profile.userId)) {
      return NextResponse.json({ error: 'Invalid LINE identity' }, { status: 401 });
    }
    const db = billingAdmin();
    const { data: booking, error: bookingError } = await db.from('bookings')
      .select('id,customer_id,stylist_id,status,source,created_at,start_time,selected_menus,total_price,menu_note')
      .eq('id', body.bookingId).maybeSingle();
    if (bookingError) throw new Error('Database unavailable');
    if (!booking) return NextResponse.json({ error: 'Booking unavailable' }, { status: 404 });
    const { data: customer, error: customerError } = await db.from('customers')
      .select('line_user_id,display_name').eq('id', booking.customer_id).maybeSingle();
    if (customerError) throw new Error('Database unavailable');
    if (!customer || customer.line_user_id !== profile.userId) {
      return NextResponse.json({ error: 'Booking unavailable' }, { status: 404 });
    }
    // A retry key is effective for 24h. Accept only new pending requests for 10min,
    // so replay cannot outlive the provider's deduplication window.
    const age = Date.now() - Date.parse(booking.created_at);
    if (booking.status !== 'pending' || booking.source !== 'liff' || !Number.isFinite(age) || age < 0 || age > 600000) {
      return NextResponse.json({ error: 'Booking notification window closed' }, { status: 409 });
    }
    const { data: stylist, error: stylistError } = await db.from('stylists')
      .select('line_user_id').eq('id', booking.stylist_id).maybeSingle();
    if (stylistError) throw new Error('Database unavailable');
    if (!stylist || typeof stylist.line_user_id !== 'string' || !lineId.test(stylist.line_user_id)) {
      return NextResponse.json({ error: 'Stylist LINE connection unavailable' }, { status: 409 });
    }
    if (!Number.isFinite(Date.parse(booking.start_time)) || !Number.isSafeInteger(booking.total_price) || booking.total_price < 0 ||
        !Array.isArray(booking.selected_menus) || booking.selected_menus.some((menu: unknown) => !menu || typeof menu !== 'object' || !('name' in menu) || typeof menu.name !== 'string')) {
      throw new Error('Invalid booking data');
    }
    const dateStr = new Date(booking.start_time).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const messageText = `📅 新規の予約リクエストが入りました！\n\n` +
      `【お客様】${customer.display_name} 様\n` +
      `【日時】${dateStr}〜\n` +
      `【メニュー】${booking.selected_menus.map((menu: { name: string }) => menu.name).join(', ')}\n` +
      `【合計料金】¥${booking.total_price.toLocaleString()}\n` +
      (booking.menu_note ? `【備考】${booking.menu_note}\n` : '') +
      `\nダッシュボードから承認を行ってください。`;
    if (messageText.length > 5000) throw new Error('Notification too long');
    const client = new line.messagingApi.MessagingApiClient({ channelAccessToken });
    try {
      await client.pushMessage({ to: stylist.line_user_id, messages: [{ type: 'text', text: messageText }] }, booking.id);
    } catch (error: unknown) {
      // LINE returns 409 when this retry key has already been accepted.
      if (!(error instanceof line.HTTPFetchError) || error.status !== 409) throw error;
    }
    return NextResponse.json({ success: true });
  } catch {
    // Never log access tokens, customer information, or SDK request/response bodies.
    console.error('LINE booking notification failed');
    return NextResponse.json({ error: 'LINE notification failed' }, { status: 503 });
  }
}
