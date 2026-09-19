import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { assertBillingOrigin, billingAdmin, getBillingStatus } from '@/lib/billing';

export async function POST(request: Request) {
  try { assertBillingOrigin(request); } catch {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  try {
    const { data: { user }, error: authError } = await createClient().auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['bookingId', 'status'].includes(key)) ||
        typeof body.bookingId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.bookingId) ||
        !['confirmed', 'cancelled'].includes(body.status)) return NextResponse.json({ error: 'Invalid booking action' }, { status: 400 });
    // Existing cancellation remains available after the paid/trial period ends.
    if (body.status === 'confirmed') {
      const billing = await getBillingStatus(user.id);
      if (!['master', 'active', 'trialing'].includes(billing.status)) return NextResponse.json({ error: 'Active access required' }, { status: 403 });
    }
    const db = billingAdmin();
    const { data: booking, error: readError } = await db.from('bookings').select('id,status')
      .eq('id', body.bookingId).eq('stylist_id', user.id).maybeSingle();
    if (readError) throw new Error('Read failed');
    if (!booking) return NextResponse.json({ error: 'Booking unavailable' }, { status: 404 });
    if (booking.status === body.status) return NextResponse.json({ success: true });
    const permitted = body.status === 'confirmed' ? ['pending'] : ['pending', 'confirmed'];
    if (!permitted.includes(booking.status)) return NextResponse.json({ error: 'Booking state changed' }, { status: 409 });
    const { data: changed, error } = await db.from('bookings').update({ status: body.status, updated_at: new Date().toISOString() })
      .eq('id', body.bookingId).eq('stylist_id', user.id).eq('status', booking.status).select('id').maybeSingle();
    if (error) throw new Error('Write failed');
    if (!changed) return NextResponse.json({ error: 'Booking state changed; refresh and retry' }, { status: 409 });
    return NextResponse.json({ success: true });
  } catch {
    console.error('Booking status operation failed');
    return NextResponse.json({ error: 'Booking update unavailable' }, { status: 503 });
  }
}
