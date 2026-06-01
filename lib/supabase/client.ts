import { createBrowserClient } from '@supabase/ssr';

// クライアントを初期化してエクスポート
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
