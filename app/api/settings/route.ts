import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { acquireBillingLock, assertBillingOrigin, billingAdmin, getBillingStatus, releaseBillingLock } from '@/lib/billing';

type Setting = { id?: string; day_of_week: number | null; specific_date: string | null; start_time: string | null; end_time: string | null; is_day_off: boolean };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const label = (value: unknown) => typeof value === 'string' && !!value.trim() && value.trim().length <= 100 && !/[\x00-\x1f\x7f]/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '9999-12-31' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const time = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) && date(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const settingKey = (s: Pick<Setting, 'specific_date' | 'day_of_week'>) => s.specific_date ? `date:${s.specific_date}` : `day:${s.day_of_week}`;
function validSetting(s: unknown): s is Setting {
  if (!object(s) || !keys(s, ['id', 'day_of_week', 'specific_date', 'start_time', 'end_time', 'is_day_off']) || (s.id !== undefined && !uuid(s.id)) || typeof s.is_day_off !== 'boolean') return false;
  if (!((s.specific_date === null && Number.isInteger(s.day_of_week) && Number(s.day_of_week) >= 0 && Number(s.day_of_week) <= 6) || (s.day_of_week === null && date(s.specific_date)))) return false;
  if (s.is_day_off) return (s.start_time === null || time(s.start_time)) && (s.end_time === null || time(s.end_time));
  return time(s.start_time) && time(s.end_time) && s.start_time.slice(0, 5) < s.end_time.slice(0, 5);
}
function validBody(body: unknown): body is Record<string, any> {
  if (!object(body)) return false;
  switch (body.action) {
    case 'menu.create': case 'menu.update':
      return keys(body, ['action', 'name', 'duration', 'price', ...(body.action === 'menu.update' ? ['id'] : [])]) && (body.action === 'menu.create' || uuid(body.id)) && label(body.name) && Number.isInteger(body.duration) && Number(body.duration) > 0 && Number(body.duration) <= 1440 && Number.isInteger(body.price) && Number(body.price) >= 0 && Number(body.price) <= 10000000;
    case 'menu.delete': case 'availability.delete': case 'blocked.delete': return keys(body, ['action', 'id']) && uuid(body.id);
    case 'blocked.create': return keys(body, ['action', 'title', 'start_time', 'end_time']) && label(body.title) && instant(body.start_time) && instant(body.end_time) && Date.parse(body.start_time) < Date.parse(body.end_time);
    case 'availability.save': return keys(body, ['action', 'settings']) && Array.isArray(body.settings) && body.settings.length >= 1 && body.settings.length <= 7 && body.settings.every(validSetting) && new Set(body.settings.map(settingKey)).size === body.settings.length && new Set(body.settings.filter(s => s.id).map(s => s.id)).size === body.settings.filter(s => s.id).length;
    default: return false;
  }
}
const failure = (error: string, status: number) => NextResponse.json({ error }, { status });
export async function POST(request: Request) {
  try { assertBillingOrigin(request); } catch { return failure('Invalid origin', 403); }
  let owner: string | undefined;
  let lock: string | null = null;
  try {
    const { data: { user }, error: authError } = await createClient().auth.getUser();
    if (authError || !user) return failure('Authentication required', 401);
    owner = user.id;
    let body: unknown;
    try { body = await request.json(); } catch { return failure('Invalid request', 400); }
    if (!validBody(body)) return failure('Invalid settings', 400);
    if (!['master', 'active', 'trialing'].includes((await getBillingStatus(user.id)).status)) return failure('Active access required', 403);
    const db = billingAdmin();
    if (body.action.startsWith('availability.')) {
      lock = await acquireBillingLock(user.id);
      if (!lock) return failure('Settings busy; retry shortly', 409);
      // Recheck entitlement after waiting for another billing operation.
      if (!['master', 'active', 'trialing'].includes((await getBillingStatus(user.id)).status)) return failure('Active access required', 403);
    }
    if (body.action === 'availability.save') {
      const { data: existing, error } = await db.from('availability_settings').select('id,day_of_week,specific_date').eq('stylist_id', user.id);
      if (error || !existing) throw Error('Read failed');
      const rows: Record<string, unknown>[] = [];
      for (const s of body.settings as Setting[]) {
        const matches = existing.filter(row => settingKey(row) === settingKey(s));
        if (matches.length > 1) return failure('Duplicate settings require review', 409);
        // A supplied ID must identify this owner's row AND the same day/date.
        if (s.id && !existing.some(row => row.id === s.id)) return failure('Setting not found', 404);
        if (s.id && matches[0]?.id !== s.id) return failure('Setting day cannot be changed', 409);
        rows.push({ id: matches[0]?.id ?? randomUUID(), stylist_id: user.id, day_of_week: s.day_of_week, specific_date: s.specific_date, start_time: s.is_day_off ? null : s.start_time, end_time: s.is_day_off ? null : s.end_time, is_day_off: s.is_day_off });
      }
      // The whole week is one PostgreSQL statement: no partially saved week.
      const { error: saveError } = await db.from('availability_settings').upsert(rows, { onConflict: 'id' });
      if (saveError) throw Error('Save failed');
    } else if (body.action === 'menu.create' || body.action === 'blocked.create') {
      const menu = body.action === 'menu.create';
      const fields = menu ? { name: body.name.trim(), duration: body.duration, price: body.price } : { title: body.title.trim(), start_time: body.start_time, end_time: body.end_time };
      const { error } = await db.from(menu ? 'menus' : 'blocked_time_slots').insert({ ...fields, stylist_id: user.id });
      if (error) throw Error('Insert failed');
    } else {
      const table = body.action.startsWith('menu.') ? 'menus' : body.action.startsWith('availability.') ? 'availability_settings' : 'blocked_time_slots';
      const query = body.action === 'menu.update' ? db.from(table).update({ name: body.name.trim(), duration: body.duration, price: body.price, updated_at: new Date().toISOString() }) : db.from(table).delete();
      const { data, error } = await query.eq('id', body.id).eq('stylist_id', user.id).select('id');
      if (error) throw Error('Mutation failed');
      if (!data?.length) return failure('Setting not found', 404);
    }
    return NextResponse.json({ ok: true });
  } catch {
    console.error('Settings mutation failed');
    return failure('Settings unavailable', 503);
  } finally {
    if (owner && lock) await releaseBillingLock(owner, lock).catch(() => console.error('Settings lock release failed'));
  }
}
