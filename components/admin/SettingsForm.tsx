'use client';
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Loader2, Save, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function SettingsForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lineUserId, setLineUserId] = useState('');

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

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('stylists')
        .update({ line_user_id: lineUserId })
        .eq('id', user.id);

      if (error) throw error;
      alert('設定を保存しました。');
    } catch (err) {
      console.error(err);
      alert('保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-500">読み込み中...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto animate-in fade-in duration-500">
      <div className="mb-6">
        <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-600 transition font-medium">
          <ArrowLeft className="w-4 h-4" />
          ダッシュボードに戻る
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">各種設定</h1>
        <p className="text-gray-500 mt-1">通知先などの基本設定を行います。</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6 md:p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-[#06C755]/10 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-[#06C755]" />
          </div>
          <div>
            <h2 className="text-lg font-bold">LINE通知設定</h2>
            <p className="text-sm text-gray-500">予約が入った際の通知先LINE User IDを設定します。</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              LINE User ID
            </label>
            <input
              type="text"
              value={lineUserId}
              onChange={(e) => setLineUserId(e.target.value)}
              placeholder="Uから始まる文字列 (例: U1234567890abcdef...)"
              className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 focus:ring-2 focus:ring-[#06C755] outline-none transition"
            />
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              ※ LINE Developers等から取得できる「ユーザーID」を入力してください。<br/>
              ※ 通知を受け取るには、事前に指定の公式アカウントを友だち追加しておく必要があります。
            </p>
          </div>

          <div className="pt-4 border-t border-gray-100 dark:border-gray-800 flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#06C755] hover:bg-[#05b34c] text-white px-6 py-2 rounded-lg font-medium shadow-sm flex items-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存する
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
