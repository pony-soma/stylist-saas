import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getBillingStatus } from '@/lib/billing';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { data: { user }, error } = await createClient().auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });
    return NextResponse.json(await getBillingStatus(user.id), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '契約状況を確認できませんでした。' }, { status: 503 });
  }
}
