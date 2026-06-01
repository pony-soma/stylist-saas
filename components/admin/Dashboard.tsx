'use client';

import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Clock, Calendar as CalendarIcon, User, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type Booking = {
  id: string;
  start_time: string;
  end_time: string;
  menu_note: string;
  status: string;
  customers: { display_name: string } | null;
};

export default function AdminDashboard() {
  const [pending, setPending] = useState<Booking[]>([]);
  const [timeline, setTimeline] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // データ取得ロジック
  const fetchData = async () => {
    setLoading(true);
    
    // 実際のログインユーザーを取得
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    setUserId(user.id);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // 1. 未承認の予約を取得
    const { data: pendingData, error: pendingError } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, menu_note, status, customers(display_name)')
      .eq('stylist_id', user.id)
      .eq('status', 'pending')
      .order('start_time', { ascending: true });

    if (!pendingError && pendingData) {
      setPending(pendingData as unknown as Booking[]);
    }

    // 2. 本日の予約タイムラインを取得
    const { data: timelineData, error: timelineError } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, menu_note, status, customers(display_name)')
      .eq('stylist_id', user.id)
      .gte('start_time', todayStart.toISOString())
      .lte('start_time', todayEnd.toISOString())
      .order('start_time', { ascending: true });

    if (!timelineError && timelineData) {
      setTimeline(timelineData as unknown as Booking[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 承認処理
  const handleApprove = async (id: string) => {
    const { error } = await supabase
      .from('bookings')
      .update({ status: 'confirmed' })
      .eq('id', id);

    if (!error) {
      // 画面上から消して、タイムラインを再取得するなどの処理
      setPending(prev => prev.filter(b => b.id !== id));
      fetchData(); // タイムライン更新のため再取得
    } else {
      console.error("Failed to approve booking:", error);
      alert("承認に失敗しました");
    }
  };

  // 日付フォーマット用ヘルパー
  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  };
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  };
  const getDurationMinutes = (start: string, end: string) => {
    return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-500">読み込み中...</div>;
  }

  if (!userId) {
    return (
      <div className="p-6 text-center text-red-500">
        <p className="font-bold">ログインされていません</p>
        <p className="text-sm mt-2 text-gray-600">Supabase Authでのログイン機能の実装とログインが必要です。</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      
      <header className="flex justify-between items-center pb-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">ダッシュボード</h1>
          <p className="text-gray-500 mt-1">本日の予約状況と未承認リクエスト</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-md">
            S
          </div>
        </div>
      </header>

      {/* 未承認アラートセクション */}
      {pending.length > 0 && (
        <section className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4 text-amber-800 dark:text-amber-500 font-semibold">
            <Clock className="w-5 h-5 animate-pulse" />
            <h2>未承認の仮予約が {pending.length} 件あります</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {pending.map((booking) => (
              <div key={booking.id} className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition hover:shadow-md">
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-400" />
                    {booking.customers?.display_name || '名称未設定'}
                  </p>
                  <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4" />
                    {formatDate(booking.start_time)} {formatTime(booking.start_time)} - {formatTime(booking.end_time)}
                  </p>
                  <p className="text-sm text-indigo-600 dark:text-indigo-400 mt-1 font-medium">{booking.menu_note}</p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button className="flex-1 sm:flex-none px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1">
                    <XCircle className="w-4 h-4" /> 拒否
                  </button>
                  <button 
                    onClick={() => handleApprove(booking.id)}
                    className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-1 shadow-sm shadow-indigo-200 dark:shadow-none"
                  >
                    <CheckCircle2 className="w-4 h-4" /> 承認
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* タイムラインセクション */}
      <section className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="p-5 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-indigo-500" />
            本日のスケジュール
          </h2>
        </div>
        <div className="p-5 relative">
          <div className="absolute left-[88px] top-5 bottom-5 w-px bg-gray-100 dark:bg-gray-800"></div>
          
          <div className="space-y-6 relative">
            {timeline.length === 0 ? (
              <p className="text-center text-gray-500 py-10">本日の予約はありません。</p>
            ) : timeline.map((item) => (
              <div key={item.id} className="flex gap-6 group cursor-pointer">
                <div className="w-16 text-right pt-2">
                  <span className="text-sm font-medium text-gray-500">{formatTime(item.start_time)}</span>
                </div>
                <div className="relative flex-1">
                  <div className={`absolute -left-[30px] top-3 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
                    item.status === 'completed' ? 'bg-gray-400' :
                    item.status === 'confirmed' ? 'bg-indigo-500' : 'bg-amber-400'
                  }`}></div>
                  
                  <div className={`p-4 rounded-xl border transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
                    item.status === 'completed' ? 'bg-gray-50 border-gray-200 dark:bg-slate-800 dark:border-gray-700 opacity-70' :
                    item.status === 'confirmed' ? 'bg-indigo-50/50 border-indigo-100 dark:bg-indigo-900/20 dark:border-indigo-800/50' : 
                    'bg-amber-50/50 border-amber-100 dark:bg-amber-900/20 dark:border-amber-800/50'
                  }`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-gray-900 dark:text-white">{item.customers?.display_name}</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{item.menu_note}</p>
                        <p className="text-xs text-gray-500 mt-2 font-medium flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {getDurationMinutes(item.start_time, item.end_time)}分
                        </p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
