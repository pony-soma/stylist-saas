import { NextResponse } from 'next/server';
import { assertBillingOrigin, billingAdmin, getBillingStatus } from '@/lib/billing';
import { verifiedLineProfile, LineBookingAuthError } from '@/lib/line-booking-auth';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request) {
  try { assertBillingOrigin(request); } catch { return json({ error: '予約画面を開き直してください。' }, 403); }
  try {
    const body = await request.json().catch(() => null);
    if (!body || !['load', 'slots', 'save'].includes(body.action) || typeof body.stylistId !== 'string' || !uuid.test(body.stylistId)) return json({ error: '予約URLをご確認ください。' }, 400);
    const allowed = body.action === 'save' ? ['action','stylistId','startTime','menuIds','menuNote','requestId']
      : body.action === 'slots' ? ['action','stylistId','date'] : ['action','stylistId'];
    if (Object.keys(body).some(key => !allowed.includes(key))) return json({ error: '予約内容をご確認ください。' }, 400);
    const profile = await verifiedLineProfile(request);
    const billing = await getBillingStatus(body.stylistId);
    if (!['master','trialing','active'].includes(billing.status)) return json({ error: '現在この担当者のオンライン予約は受け付けていません。' }, 403);
    const db = billingAdmin();
    const stylist = await db.from('stylists').select('id,name').eq('id', body.stylistId).maybeSingle();
    if (stylist.error) throw Error();
    if (!stylist.data) return json({ error: '予約先が見つかりません。URLをご確認ください。' }, 404);
    if (body.action === 'load') {
      const [menus, settings] = await Promise.all([
        db.from('menus').select('id,name,duration,price').eq('stylist_id', body.stylistId).order('created_at'),
        db.from('availability_settings').select('day_of_week,specific_date,start_time,end_time,is_day_off').eq('stylist_id', body.stylistId),
      ]);
      if (menus.error || settings.error) throw Error();
      return json({ displayName: profile.displayName, stylistName: stylist.data.name, menus: menus.data, settings: settings.data });
    }
    if (body.action === 'slots') {
      if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !Number.isFinite(Date.parse(body.date))) return json({ error: '日付をご確認ください。' }, 400);
      const start = new Date(`${body.date}T00:00:00+09:00`);
      const end = new Date(start.getTime() + 86400000);
      // Only unavailable intervals are returned. No customer, booking, or block titles.
      const blocks = await db.from('blocked_time_slots').select('start_time,end_time').eq('stylist_id', body.stylistId)
        .lt('start_time', end.toISOString()).gt('end_time', start.toISOString());
      if (blocks.error) throw Error();
      return json({ blocks: blocks.data });
    }
    if (typeof body.startTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(body.startTime) || !Number.isFinite(Date.parse(body.startTime)) ||
        !Array.isArray(body.menuIds) || body.menuIds.length < 1 || body.menuIds.length > 20 || body.menuIds.some((id: unknown) => typeof id !== 'string' || !uuid.test(id)) || new Set(body.menuIds).size !== body.menuIds.length ||
        typeof body.menuNote !== 'string' || body.menuNote.length > 5000 || /\x00/.test(body.menuNote) || typeof body.requestId !== 'string' || !uuid.test(body.requestId)) return json({ error: '日時・メニュー・備考をご確認ください。' }, 400);
    const result = await db.rpc('save_verified_liff_booking', {
      p_stylist_id: body.stylistId, p_line_user_id: profile.userId, p_display_name: profile.displayName,
      p_start_time: body.startTime, p_menu_ids: [...body.menuIds].sort(), p_menu_note: body.menuNote, p_request_id: body.requestId,
    });
    if (result.error) {
      const code = result.error.code;
      if (code === '42501') return json({ error: '現在この担当者のオンライン予約は受け付けていません。' }, 403);
      if (code === '40001') return json({ error: '選択した枠または予約内容が変更されています。画面を更新してご確認ください。' }, 409);
      if (code === '22023' || code === 'P0002') return json({ error: '営業時間・メニュー・日時が変更されています。画面を開き直して選択してください。' }, 400);
      throw Error();
    }
    if (typeof result.data !== 'string') throw Error();
    return json({ id: result.data }, 201);
  } catch (error) {
    if (error instanceof LineBookingAuthError) return json({ error: 'LINEのログインを確認できません。予約URLから開き直してください。' }, 401);
    // Deliberately omit tokens, profiles, request bodies and database details.
    console.error('LINE booking request unavailable');
    return json({ error: '予約情報を読み込めませんでした。時間をおいて再度お試しください。' }, 503);
  }
}
