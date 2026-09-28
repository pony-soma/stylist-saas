import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { assertBillingOrigin, billingAdmin, getBillingStatus } from '@/lib/billing';

export async function PATCH(request: Request) {
  try { assertBillingOrigin(request); } catch {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  try {
    const { data: { user }, error: authError } = await createClient().auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
    const fields = ['phone_number', 'birth_date', 'gender', 'address', 'memo'];
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['customerId', 'field', 'value'].includes(key))
      || typeof body.customerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.customerId)
      || !fields.includes(body.field) || typeof body.value !== 'string') {
      return NextResponse.json({ error: 'Invalid profile' }, { status: 400 });
    }
    const { customerId, field } = body;
    const value = body.value.trim();
    const today = new Date().toISOString().slice(0, 10);
    if (/\x00/.test(value) || value.length > (field === 'address' ? 1000 : 5000)
      || (field === 'phone_number' && value && !/^[+0-9() -]{3,20}$/.test(value))
      || (field === 'gender' && !['unspecified', 'male', 'female', 'other'].includes(value))
      || (field === 'birth_date' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value)
        || value < '1900-01-01' || value > today || !Number.isFinite(Date.parse(value))
        || new Date(value).toISOString().slice(0, 10) !== value))) {
      return NextResponse.json({ error: 'Invalid profile' }, { status: 400 });
    }
    const billing = await getBillingStatus(user.id);
    if (!['master', 'active', 'trialing'].includes(billing.status)) return NextResponse.json({ error: 'Active access required' }, { status: 403 });
    const db = billingAdmin();
    const { data: relationship, error: readError } = await db.from('stylist_customers')
      .select('customer_id').eq('stylist_id', user.id).eq('customer_id', customerId).maybeSingle();
    if (readError) throw new Error('Read failed');
    if (!relationship) return NextResponse.json({ error: 'Customer unavailable' }, { status: 404 });
    // Save only the edited field: concurrent blurs cannot overwrite unrelated details.
    if (field === 'phone_number') {
      const { data, error } = await db.from('customers').update({ phone_number: value || null })
        .eq('id', customerId).select('id').single();
      if (error || !data) throw new Error('Save failed');
    } else {
      const { error } = await db.from('customer_memos').upsert({
        stylist_id: user.id, customer_id: customerId, [field]: value || null, updated_at: new Date().toISOString(),
      }, { onConflict: 'stylist_id,customer_id' });
      if (error) throw new Error('Save failed');
    }
    return NextResponse.json({ success: true });
  } catch {
    console.error('Customer profile save failed');
    return NextResponse.json({ error: 'Profile save unavailable' }, { status: 503 });
  }
}
