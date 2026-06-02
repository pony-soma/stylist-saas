import { NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // const next = searchParams.get('next') ?? '/admin' // ログイン後はダッシュボードへ

  if (code) {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value
          },
          set(name: string, value: string, options: CookieOptions) {
            cookieStore.set({ name, value, ...options })
          },
          remove(name: string, options: CookieOptions) {
            cookieStore.delete({ name, ...options })
          },
        },
      }
    )
    const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error && sessionData?.user) {
      const user = sessionData.user;
      
      // 美容師テーブルに存在するか確認し、なければ作成
      const { data: stylist } = await supabase.from('stylists').select('id').eq('id', user.id).single();
      if (!stylist) {
        await supabase.from('stylists').insert({
          id: user.id,
          name: user.user_metadata?.full_name || '美容師'
        });
        
        // 無料トライアル（1年間有効とする等）のサブスクリプションを自動作成
        const start = new Date();
        const end = new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);
        await supabase.from('subscriptions').insert({
          stylist_id: user.id,
          status: 'active',
          plan_id: 'plan_basic',
          current_period_start: start.toISOString(),
          current_period_end: end.toISOString()
        });
      }
      
      return NextResponse.redirect(`${origin}/admin`)
    }
    // エラー詳細をURLに含めてリダイレクト
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error?.message || 'auth failed')}`)
  }

  // codeが無い場合
  return NextResponse.redirect(`${origin}/login?error=no-code-provided`)
}
