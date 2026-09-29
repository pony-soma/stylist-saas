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
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['customerId', 'archived'].includes(key))
      || typeof body.customerId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.customerId)
      || typeof body.archived !== 'boolean') {
      return NextResponse.json({ error: 'Invalid customer' }, { status: 400 });
    }
    const billing = await getBillingStatus(user.id);
    if (!['master', 'active', 'trialing'].includes(billing.status)) return NextResponse.json({ error: 'Active access required' }, { status: 403 });
    // Scope the update itself to the verified owner; never delete the relationship.
    const { data, error } = await billingAdmin().from('stylist_customers')
      .update({ archived_at: body.archived ? new Date().toISOString() : null })
      .eq('stylist_id', user.id).eq('customer_id', body.customerId)
      .select('customer_id').maybeSingle();
    if (error) throw new Error('Archive update failed');
    if (!data) return NextResponse.json({ error: 'Customer unavailable' }, { status: 404 });
    return NextResponse.json({ archived: body.archived });
  } catch {
    console.error('Customer archive update failed');
    return NextResponse.json({ error: 'Customer update unavailable' }, { status: 503 });
  }
}
