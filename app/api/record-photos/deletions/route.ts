import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { billingAdmin } from '@/lib/billing';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
export async function GET() {
  try {
    const { data: { user }, error: authError } = await createClient().auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers });
    // Completing already-authorized deletion is allowed after a subscription expires.
    // Never return the private object path or another stylist's work queue.
    const { data, error } = await billingAdmin().from('photo_deletion_jobs').select('photo_id')
      .eq('stylist_id', user.id).is('completed_at', null).order('requested_at').limit(100);
    if (error) throw new Error('Read failed');
    return NextResponse.json({ photoIds: (data ?? []).map(row => row.photo_id) }, { headers });
  } catch {
    return NextResponse.json({ error: 'Photo deletion status unavailable' }, { status: 503, headers });
  }
}
