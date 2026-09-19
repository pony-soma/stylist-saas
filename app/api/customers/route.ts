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
    const fields = ['display_name', 'phone_number', 'birth_date', 'gender', 'memo'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key)) ||
        typeof body.display_name !== 'string' || !body.display_name.trim() || body.display_name.trim().length > 50 ||
        fields.some(key => body[key] !== undefined && typeof body[key] !== 'string')) {
      return NextResponse.json({ error: 'Invalid customer details' }, { status: 400 });
    }
    const name = body.display_name.trim();
    const phone = (body.phone_number ?? '').trim();
    const birth = body.birth_date || null;
    const gender = body.gender ?? 'unspecified';
    const memo = (body.memo ?? '').trim();
    const today = new Date().toISOString().slice(0, 10);
    if (/[\x00-\x1f\x7f]/.test(name) || (phone && !/^[+0-9() -]{3,20}$/.test(phone)) ||
        !['unspecified', 'male', 'female', 'other'].includes(gender) || memo.length > 5000 || /\x00/.test(memo) ||
        (birth && (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || birth < '1900-01-01' || birth > today ||
          !Number.isFinite(Date.parse(birth)) || new Date(birth).toISOString().slice(0, 10) !== birth))) {
      return NextResponse.json({ error: 'Invalid customer details' }, { status: 400 });
    }
    const billing = await getBillingStatus(user.id);
    if (!['master', 'active', 'trialing'].includes(billing.status)) return NextResponse.json({ error: 'Active access required' }, { status: 403 });
    // The RPC repeats billing authorization inside the same transaction as all three inserts.
    // LINE identity and ownership are never accepted from the browser.
    const { data, error } = await billingAdmin().rpc('create_manual_customer', {
      p_stylist_id: user.id, p_display_name: name, p_phone_number: phone || null,
      p_birth_date: birth, p_gender: gender, p_memo: memo || null,
    });
    if (error?.code === '42501') return NextResponse.json({ error: 'Active access required' }, { status: 403 });
    if (error || typeof data !== 'string') throw new Error('Create failed');
    return NextResponse.json({ id: data }, { status: 201 });
  } catch {
    console.error('Customer registration failed');
    return NextResponse.json({ error: 'Customer registration unavailable' }, { status: 503 });
  }
}
