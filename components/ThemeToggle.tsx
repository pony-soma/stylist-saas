'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { supabase } from '@/lib/supabase/client';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [userId, setUserId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMounted(true);
    // マウント時に現在ログイン中のユーザーを取得し、DBに保存されたテーマ設定を反映する
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserId(user.id);
        supabase.from('stylists').select('theme').eq('id', user.id).single()
          .then(({ data }) => {
            if (data && data.theme && (data.theme === 'light' || data.theme === 'dark')) {
              setTheme(data.theme);
            }
          });
      }
    });
  }, [setTheme]);

  if (!mounted) {
    return (
      <button className="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-slate-700 transition">
        <div className="w-5 h-5" />
      </button>
    );
  }

  const handleToggle = async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme); // クライアント側のUIを即時更新
    if (userId) {
      // データベースに変更を同期（別ブラウザや別ユーザーへの影響を防ぐ）
      await supabase.from('stylists').update({ theme: newTheme }).eq('id', userId);
    }
  };

  return (
    <button
      onClick={handleToggle}
      className="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-slate-700 transition shadow-sm"
      title="テーマ切り替え"
    >
      {theme === 'dark' ? (
        <Sun className="w-5 h-5 text-amber-400" />
      ) : (
        <Moon className="w-5 h-5 text-indigo-500" />
      )}
    </button>
  );
}
