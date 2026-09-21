'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export default function AccountSwitcher() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email || '');
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const switchAccount = async () => {
    setBusy(true);
    setError('');
    try {
      // Switching this browser must not sign out the user's other devices.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      // Discard cached pages belonging to the previous account.
      window.location.replace('/login');
    } catch {
      setError('ログアウトできませんでした。もう一度お試しください。');
      setBusy(false);
    }
  };

  return (
    <section aria-label="ログイン中のアカウント" className="my-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
      {email && <p className="break-all">ログイン中：{email}</p>}
      <button type="button" onClick={() => void switchAccount()} disabled={busy}
        className="mt-2 min-h-11 rounded-lg border border-indigo-600 px-3 py-2 font-semibold text-indigo-700 disabled:opacity-50">
        {busy ? 'ログアウト中…' : '別のGoogleアカウントに切り替える'}
      </button>
      <p className="mt-2 text-xs">このブラウザからログアウトします。契約や保存したデータは削除されません。</p>
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    </section>
  );
}
