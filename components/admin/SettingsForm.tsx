'use client';
import React, { useState, useEffect, Suspense } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Loader2, MessageCircle, Link as LinkIcon, Unlink, CheckCircle2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

function SettingsContent() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lineUserId, setLineUserId] = useState('');
  const searchParams = useSearchParams();

  const successParam = searchParams.get('success');
  const errorParam = searchParams.get('error');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('stylists')
        .select('line_user_id')
        .eq('id', user.id)
        .single();

      if (data && data.line_user_id) {
        setLineUserId(data.line_user_id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirm('LINE連携を解除しますか？（予約の通知が届かなくなります）')) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('stylists')
        .update({ line_user_id: null })
        .eq('id', user.id);

      if (error) throw error;
      setLineUserId('');
      alert('連携を解除しました。');
    } catch (err) {
      console.error(err);
      alert('解除に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const handleLink = () => {
    window.location.href = '/api/auth/line';
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-500">読み込み中...</div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto animate-in fade-in duration-500">
      <div className="mb-6">
        <Link href="/admin/settings" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#06C755] transition font-medium">
          <ArrowLeft className="w-4 h-4" />
          設定一覧に戻る
        </Link>
      </div>

      <div className="mb-8 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-[#06C755]/10 flex items-center justify-center shrink-0">
          <MessageCircle className="w-6 h-6 text-[#06C755]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">LINE通知設定</h1>
          <p className="text-gray-500 mt-1">予約リクエストが入った際の通知先として、あなたのLINEアカウントを連携します。</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6 md:p-8">

        {successParam === 'line_linked' && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <h3 className="font-bold text-green-800">連携完了</h3>
              <p className="text-sm text-green-700 mt-1">LINEアカウントの連携が完了しました。以降、予約リクエストの通知が個人のLINEに届きます。</p>
            </div>
          </div>
        )}

        {errorParam && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <h3 className="font-bold text-red-800">連携エラー</h3>
              <p className="text-sm text-red-700 mt-1">LINEの連携に失敗しました。もう一度お試しください。({errorParam})</p>
            </div>
          </div>
        )}

        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-slate-800/30">
            <div>
              <p className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                連携ステータス: 
                {lineUserId ? (
                  <span className="text-[#06C755] flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> 連携済み</span>
                ) : (
                  <span className="text-gray-500">未連携</span>
                )}
              </p>
              {lineUserId && (
                <p className="text-xs text-gray-500 mt-1">ID: {lineUserId}</p>
              )}
            </div>

            {lineUserId ? (
              <button
                onClick={handleUnlink}
                disabled={saving}
                className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2 transition disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
                連携を解除する
              </button>
            ) : (
              <button
                onClick={handleLink}
                className="px-5 py-2.5 bg-[#06C755] hover:bg-[#05b34c] text-white rounded-lg text-sm font-bold flex items-center gap-2 transition shadow-sm"
              >
                <LinkIcon className="w-4 h-4" />
                LINEと連携する
              </button>
            )}
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-100 dark:border-blue-900/50">
            <h3 className="font-bold text-blue-800 dark:text-blue-300 mb-2 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              【重要】通知を受け取るために
            </h3>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              この連携ボタンを押してあなたのLINEを紐付けたあと、通知の送信元となる<strong>公式アカウントを「友だち追加」</strong>しておく必要があります。友だち追加されていないと、システムからメッセージを送信できません。
            </p>
            <a
              href="https://lin.ee/PLovQIR"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#06C755] hover:bg-[#05b34c] text-white rounded-lg text-sm font-bold transition shadow-sm"
            >
              <MessageCircle className="w-4 h-4" />
              通知用LINEを友だち追加する
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsForm() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-gray-500">読み込み中...</div>}>
      <SettingsContent />
    </Suspense>
  );
}
