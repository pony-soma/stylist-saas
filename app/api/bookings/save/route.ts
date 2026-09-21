import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { assertBillingOrigin, billingAdmin, getBillingStatus } from '@/lib/billing';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export async function POST(request: Request) {
  try { assertBillingOrigin(request); } catch { return NextResponse.json({ error: 'Invalid origin' }, { status: 403 }); }
  try {
    const { data: { user }, error: authError } = await createClient().auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
    const allowed = ['customerId', 'startTime', 'endTime', 'menuIds', 'menuNote', 'requestId', 'bookingId', 'expectedUpdatedAt'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key)) ||
      !timestamp(body.startTime) || !timestamp(body.endTime) || Date.parse(body.endTime) <= Date.parse(body.startTime) ||
      !Array.isArray(body.menuIds) || body.menuIds.length > 20 || body.menuIds.some((id: unknown) => typeof id !== 'string' || !uuid.test(id)) ||
      new Set(body.menuIds).size !== body.menuIds.length || typeof body.menuNote !== 'string' || body.menuNote.length > 5000 || /\x00/.test(body.menuNote)) {
      return NextResponse.json({ error: 'Invalid booking details' }, { status: 400 });
    }
    const editing = body.bookingId !== undefined;
    if ((editing && (typeof body.bookingId !== 'string' || !uuid.test(body.bookingId) || !timestamp(body.expectedUpdatedAt) || body.requestId !== undefined || body.customerId !== undefined)) ||
      (!editing && (typeof body.customerId !== 'string' || !uuid.test(body.customerId) || typeof body.requestId !== 'string' || !uuid.test(body.requestId) || body.expectedUpdatedAt !== undefined))) {
      return NextResponse.json({ error: 'Invalid booking details' }, { status: 400 });
    }
    const billing = await getBillingStatus(user.id);
    if (!['master', 'active', 'trialing'].includes(billing.status)) return NextResponse.json({ error: 'Active access required' }, { status: 403 });
    const admin = billingAdmin();
    let customerId = body.customerId;
    if (editing) {
      const { data: previous, error } = await admin.from('bookings').select('customer_id').eq('id', body.bookingId).eq('stylist_id', user.id).maybeSingle();
      if (error) throw Error('Booking lookup failed');
      if (!previous) return NextResponse.json({ error: 'Booking unavailable' }, { status: 404 });
      customerId = previous.customer_id;
    }
    const { data, error } = await admin.rpc('save_proxy_booking', {
      p_stylist_id: user.id, p_customer_id: customerId, p_start_time: body.startTime, p_end_time: body.endTime,
      p_menu_ids: body.menuIds, p_menu_note: body.menuNote, p_request_id: body.requestId ?? null,
      p_booking_id: body.bookingId ?? null, p_expected_updated_at: body.expectedUpdatedAt ?? null,
    });
    if (error) {
      const statuses: Record<string, number> = { '42501': 403, 'P0002': 404, '22023': 400, '22007': 400, '22008': 400, '40001': 409 };
      // Only expose known, static guidance, never raw database messages or details.
      const reasons: Record<string, string> = {
        'Outside opening hours': '定休日または営業時間外です。日付・時間を変更するか、設定の「営業時間・定休日設定」で臨時営業日を登録してください。',
        'Ambiguous opening hours': '営業時間の設定が重複しています。「営業時間・定休日設定」を確認してください。',
        'Invalid menus': '選択したメニューが変更または削除されています。画面を更新して選び直してください。',
        'Blocked time': '指定された時間には予約不可枠があります。時間を変更してください。',
        'Booking changed': '予約が別の操作で変更されています。画面を更新してください。',
        'Request conflict': '前回の予約内容と異なります。画面を更新して予約を確認してください。',
        'Customer unavailable': 'このお客様を選択できません。画面を更新して選び直してください。',
        'Booking unavailable': 'この予約を編集できません。画面を更新してください。',
        'Active access required': 'ご利用期間を確認できません。「契約・お支払い」で契約状態を確認してください。',
      };
      if (statuses[error.code]) return NextResponse.json({ error: reasons[error.message] ?? '予約内容を確認して、もう一度お試しください。' }, { status: statuses[error.code] });
      throw Error('Booking save failed');
    }
    if (typeof data !== 'string') throw Error('Missing booking');
    return NextResponse.json({ id: data }, { status: editing ? 200 : 201 });
  } catch {
    console.error('Booking save unavailable');
    return NextResponse.json({ error: 'Booking save unavailable' }, { status: 503 });
  }
}
