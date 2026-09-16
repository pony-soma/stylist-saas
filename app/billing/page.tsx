'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Billing = {
  status: 'master' | 'trialing' | 'active' | 'expired' | 'pending';
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canCheckout: boolean;
  trialEligible: boolean;
};

export default function BillingPage() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [returned, setReturned] = useState(false);
  const [portalReturned, setPortalReturned] = useState(false);
  const [canceled, setCanceled] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/billing/status', { cache: 'no-store', signal });
      if (response.status === 401) {
        window.location.assign('/login?next=/billing');
        return;
      }
      if (!response.ok) throw new Error('契約状態を取得できませんでした。少し待って再確認してください。');
      const data: Billing = await response.json();
      if (!signal?.aborted) setBilling(data);
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : '契約状態を取得できませんでした。');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReturned(params.get('success') === 'true');
    setPortalReturned(params.get('portal_return') === 'true');
    setCanceled(params.get('canceled') === 'true');
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  // A successful redirect is not proof of payment. Refresh the server state while the webhook arrives.
  useEffect(() => {
    if (!returned || (billing?.status !== 'pending' && billing?.status !== 'expired')) return;
    let attempts = 0;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      attempts += 1;
      void refresh(controller.signal);
      if (attempts >= 5) window.clearInterval(timer);
    }, 3000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [returned, billing?.status, refresh]);

  // Portal redirects can precede the webhook, including cancellation reversals.
  // A query parameter only requests polling; it never determines entitlement.
  useEffect(() => {
    if (!portalReturned) return;
    let attempts = 0;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void refresh(controller.signal);
      if (++attempts >= 5) window.clearInterval(timer);
    }, 3000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [portalReturned, refresh]);

  const openPayment = async (portal: boolean) => {
    if (!portal && !consent) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(portal ? '/api/billing/portal' : '/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(portal ? {} : { consent: true }),
      });
      if (response.status === 401) {
        window.location.assign('/login?next=/billing');
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || 'お支払い画面を開けませんでした。再度お試しください。');
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'お支払い画面を開けませんでした。');
      setBusy(false);
    }
  };

  const status = billing?.status;
  const hasAccess = status === 'master' || status === 'active' || status === 'trialing';
  const end = billing?.periodEnd ? new Date(billing.periodEnd).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + '（日本時間）' : null;
  const labels = { master: '永久無料アカウント', active: 'ご契約中', trialing: '無料体験中', expired: 'ご利用期間終了・お支払い確認', pending: 'ご利用開始の手続き' };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900">
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 sm:p-10 shadow-sm">
        <Link href="/" className="font-bold text-indigo-600">LiNo</Link>
        <h1 className="mt-6 text-2xl font-bold">契約・お支払い</h1>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        {loading && <p role="status" className="mt-4 text-sm text-slate-600">契約状態を確認しています…</p>}
        {canceled && <p className="mt-4 text-sm text-slate-600">お支払い手続きを中断しました。契約状態は下記をご確認ください。</p>}
        {returned && !hasAccess && <p role="status" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">お手続きの結果を確認中です。反映まで時間がかかる場合があります。重複して申し込まず、しばらく待って「契約状態を再確認」を押してください。</p>}
        {billing && <section className="mt-6 space-y-4">
          <h2 className="text-lg font-semibold">{labels[billing.status]}</h2>
          {status === 'master' ? <p>このアカウントは期限なく無料で利用できます。カード登録は不要です。</p> : <>
            <p className="text-2xl font-bold">月額1,980円（税込）</p>
            {status === 'trialing' && <p>無料体験終了：{end || '確認中'}。{billing.cancelAtPeriodEnd ? '解約予約済みです。体験終了後の課金はありません。' : '終了前に解約しない場合、終了後に月額料金が自動で請求されます。'}</p>}
            {status === 'active' && <p>{billing.cancelAtPeriodEnd ? '解約予約済みです。ご利用期限：' : '現在のご利用期間の終了：'}{end || '確認中'}</p>}
            {status === 'pending' && <p>{billing.trialEligible ? 'カード登録完了後、14日間無料でお試しいただけます。無料体験は初回のみです。' : '以前にご利用いただいているため、無料体験の追加はありません。月額1,980円（税込）で再開できます。'}</p>}
            {status === 'expired' && <p>継続利用には、お支払い情報の更新または再契約が必要です。再契約で無料体験は追加されません。</p>}
            {(status === 'active' || status === 'trialing' || status === 'expired') && <button onClick={() => void openPayment(true)} disabled={busy || loading} className="w-full rounded-xl border border-indigo-600 px-4 py-3 font-bold text-indigo-700 disabled:opacity-50">{busy ? '移動中…' : 'お支払い情報・解約を管理'}</button>}
            {billing.canCheckout && <div className="space-y-4 border-t pt-4">
              <p className="text-sm text-slate-600">{billing.trialEligible ? 'カード登録が必要です。初回の無料体験終了後は月額1,980円（税込）で自動更新します。課金開始前に解約すれば料金は発生しません。' : '再契約は無料体験なしで、月額1,980円（税込）の課金が始まります。'}有料期間中に解約した場合は、その期間の終了まで利用できます。解約はこの画面の「お支払い情報・解約を管理」から行えます。</p>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />無料体験が初回のみであること、月額1,980円（税込）の自動更新と解約条件を確認し、同意します。</label>
              <button onClick={() => void openPayment(false)} disabled={!consent || busy || loading || returned} className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? '移動中…' : !billing.trialEligible ? '再契約の条件を確認する' : 'カード登録へ進む'}</button>
            </div>}
          </>}
        </section>}
        <div className="mt-8 flex flex-wrap items-center gap-4 text-sm">
          <button onClick={() => void refresh()} disabled={loading || busy} className="underline text-slate-600 disabled:opacity-50">契約状態を再確認</button>
          {billing && status !== 'pending' && <Link href="/admin" className="font-bold text-indigo-600">管理画面へ</Link>}
        </div>
      </div>
    </main>
  );
}
