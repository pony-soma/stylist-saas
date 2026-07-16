'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { AlertCircle, ArrowRight, CreditCard, Clock } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export function SubscriptionBanner({ userId, userEmail }: { userId: string | null, userEmail?: string | null }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'active' | 'trialing' | 'expired' | null>(null);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [autoCheckoutTriggered, setAutoCheckoutTriggered] = useState(false);
  const searchParams = useSearchParams();

  // 特権アカウントの判定
  const isSuperAdmin = userEmail === 'pony.soma@gmail.com';

  useEffect(() => {
    if (!userId || isSuperAdmin) {
      if (isSuperAdmin) setStatus('active');
      setLoading(false);
      return;
    }

    const fetchSubscriptionStatus = async () => {
      try {
        // 1. サブスクリプション状態の取得
        const { data: subData } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('stylist_id', userId)
          .maybeSingle();

        if (subData && subData.status === 'active') {
          setStatus('active');
          return;
        }

        // 2. スタイリストの登録日を取得（トライアル期間計算用）
        const { data: stylistData } = await supabase
          .from('stylists')
          .select('created_at')
          .eq('id', userId)
          .single();

        let trialEndDate = new Date();
        
        if (subData && subData.status === 'trialing') {
          trialEndDate = new Date(subData.current_period_end);
        } else if (stylistData) {
          // デフォルト：登録日から14日間
          trialEndDate = new Date(stylistData.created_at);
          trialEndDate.setDate(trialEndDate.getDate() + 14);
        }

        const now = new Date();
        const diffTime = trialEndDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          setStatus('expired');
        } else {
          setStatus('trialing');
          setDaysLeft(diffDays);
        }
      } catch (err) {
        console.error('Failed to fetch subscription status:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSubscriptionStatus();
  }, [userId]);

  if (loading || status === 'active' || !status) return null;

  const handleCheckout = async () => {
    try {
      setLoading(true);
      const planId = process.env.NEXT_PUBLIC_STRIPE_PRO_PLAN_ID;
      
      if (!planId) {
        alert('プランIDが設定されていません。環境変数をご確認ください。');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });

      if (!res.ok) throw new Error('Failed to create checkout session');
      
      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      }
    } catch (err) {
      console.error(err);
      alert('決済画面の生成に失敗しました。');
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status && status !== 'active' && !autoCheckoutTriggered && searchParams.get('plan') === 'pro') {
      setAutoCheckoutTriggered(true);
      handleCheckout();
    }
  }, [status, searchParams, autoCheckoutTriggered]);

  return (
    <div className={`w-full p-4 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-sm sm:text-base border-b z-50 relative ${
      status === 'expired' 
        ? 'bg-red-50 text-red-900 border-red-200 dark:bg-red-900/30 dark:border-red-900/50 dark:text-red-200' 
        : 'bg-orange-50 text-orange-900 border-orange-200 dark:bg-orange-900/30 dark:border-orange-900/50 dark:text-orange-200'
    }`}>
      <div className="flex flex-col sm:flex-row items-center gap-2 font-medium text-center sm:text-left">
        {status === 'expired' ? (
          <>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400" />
              <span>無料トライアル期間が終了しました。</span>
            </div>
            <span>引き続きご利用いただくには、プロプラン（月額1,980円）へのご登録が必要です。</span>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 shrink-0 text-orange-600 dark:text-orange-400" />
              <span>現在無料トライアル期間中です。全機能を利用できるプロプラン（月額1,980円）をご検討ください。</span>
            </div>
            {daysLeft !== null && daysLeft <= 7 && (
              <span className="inline-flex items-center justify-center gap-1 px-2.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 font-bold ml-0 sm:ml-2 mt-1 sm:mt-0">
                <Clock className="w-3.5 h-3.5" />
                残り {daysLeft} 日
              </span>
            )}
          </>
        )}
      </div>
      
      <button 
        onClick={handleCheckout}
        disabled={loading}
        className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full font-bold text-white shadow-sm transition hover:shadow-md w-full sm:w-auto ${
          status === 'expired' ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-600 hover:bg-orange-700'
        } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {loading ? '読み込み中...' : 'プラン詳細・お支払い'}
        {!loading && <ArrowRight className="w-4 h-4" />}
      </button>
    </div>
  );
}
