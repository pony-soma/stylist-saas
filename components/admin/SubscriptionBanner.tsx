'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type BillingStatus = {
  status: 'master' | 'trialing' | 'active' | 'expired' | 'pending';
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export function SubscriptionBanner() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setBilling(null);
    setFailed(false);
    fetch('/api/billing/status', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('契約状態を確認できませんでした。');
        const data = await response.json();
        if (!controller.signal.aborted) setBilling(data);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);

  if (!failed && (!billing || billing.status === 'master' || (billing.status === 'active' && !billing.cancelAtPeriodEnd))) return null;

  const end = billing?.periodEnd ? new Date(billing.periodEnd).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + '（日本時間）' : null;
  const message = failed ? '契約状態を確認できませんでした。お支払い画面で再確認してください。'
    : billing?.status === 'pending' ? 'カード登録を完了すると、ご利用を開始できます。'
    : billing?.status === 'expired' ? 'ご利用期間が終了しているか、お支払いの確認が必要です。'
    : billing?.cancelAtPeriodEnd ? `解約予約済みです。${end ? `${end}までご利用いただけます。` : ''}`
    : `14日間の無料体験中です。${end ? `${end}に終了し、解約しない場合は月額1,980円の自動課金が始まります。` : ''}`;

  return (
    <div role="status" className="relative border-b border-orange-200 bg-orange-50 p-4 text-sm text-orange-950 flex flex-col sm:flex-row items-center justify-center gap-3">
      <p>{message}</p>
      <Link href="/billing" className="shrink-0 rounded-full bg-indigo-600 px-4 py-2 font-bold text-white hover:bg-indigo-700">契約・お支払い・解約</Link>
    </div>
  );
}
