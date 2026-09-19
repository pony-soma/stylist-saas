import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { assertBillingOrigin, billingAdmin, getBillingStatus } from '@/lib/billing';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '1900-01-01' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export async function POST(request: Request) {
  try { assertBillingOrigin(request); } catch { return NextResponse.json({ error: 'Invalid origin' }, { status: 403 }); }
  try {
    const { data: { user }, error: authError } = await createClient().auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
    const allowed = ['action', 'id', 'customerId', 'visit_date', 'treatment_menu', 'chemicals_used', 'notes', 'expectedRevision'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k)) ||
      !['create', 'update'].includes(body.action) || typeof body.id !== 'string' || !uuid.test(body.id) || !validDate(body.visit_date) ||
      typeof body.treatment_menu !== 'string' || !body.treatment_menu.trim() || body.treatment_menu.trim().length > 255 ||
      typeof body.chemicals_used !== 'string' || body.chemicals_used.length > 5000 || typeof body.notes !== 'string' || body.notes.length > 10000 ||
      [body.treatment_menu, body.chemicals_used, body.notes].some(v => /\x00/.test(v)) ||
      (body.action === 'create' ? typeof body.customerId !== 'string' || !uuid.test(body.customerId) || body.expectedRevision !== undefined :
        body.customerId !== undefined || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)) {
      return NextResponse.json({ error: 'Invalid medical record' }, { status: 400 });
    }
    const billing = await getBillingStatus(user.id);
    if (!['master', 'active', 'trialing'].includes(billing.status)) return NextResponse.json({ error: 'Active access required' }, { status: 403 });
    const { data, error } = await billingAdmin().rpc('save_medical_record', {
      p_stylist_id: user.id, p_action: body.action, p_id: body.id, p_customer_id: body.customerId ?? null,
      p_visit_date: body.visit_date, p_treatment_menu: body.treatment_menu.trim(), p_chemicals_used: body.chemicals_used,
      p_notes: body.notes, p_expected_revision: body.expectedRevision ?? null,
    });
    if (error) {
      const statuses: Record<string, number> = { '42501': 403, 'P0002': 404, '22023': 400, '22007': 400, '22008': 400, '40001': 409 };
      if (statuses[error.code]) return NextResponse.json({ error: 'Medical record could not be saved' }, { status: statuses[error.code] });
      throw Error('Save failed');
    }
    if (typeof data !== 'string') throw Error('Missing record');
    return NextResponse.json({ id: data }, { status: body.action === 'create' ? 201 : 200 });
  } catch {
    console.error('Medical record save unavailable');
    return NextResponse.json({ error: 'Medical record save unavailable' }, { status: 503 });
  }
}
