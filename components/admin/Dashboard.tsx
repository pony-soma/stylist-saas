'use client';

import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Clock, Calendar as CalendarIcon, User, ChevronRight, ChevronLeft } from 'lucide-react';
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
  const [monthBookings, setMonthBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // データ取得ロジック
  const fetchData = async (targetMonth: Date) => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    setUserId(user.id);

    // 1. 未承認の予約を取得
    const { data: pendingData } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, menu_note, status, customers(display_name)')
      .eq('stylist_id', user.id)
      .eq('status', 'pending')
      .order('start_time', { ascending: true });

    if (pendingData) setPending(pendingData as unknown as Booking[]);

    // 2. 指定月の予約をすべて取得 (少し前後の余裕を持たせる)
    const firstDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
    const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59);
    
    const { data: monthData } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, menu_note, status, customers(display_name)')
      .eq('stylist_id', user.id)
      .gte('start_time', firstDay.toISOString())
      .lte('start_time', lastDay.toISOString())
      .order('start_time', { ascending: true });

    if (monthData) setMonthBookings(monthData as unknown as Booking[]);

    setLoading(false);
  };

  useEffect(() => {
    fetchData(currentMonth);
  }, [currentMonth]);

  const handleApprove = async (id: string) => {
    const { error } = await supabase
      .from('bookings')
      .update({ status: 'confirmed' })
      .eq('id', id);

    if (!error) {
      fetchData(currentMonth);
    } else {
      alert("承認に失敗しました");
    }
  };

  const handleReject = async (id: string) => {
    const { error } = await supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', id);
    if (!error) {
      fetchData(currentMonth);
    }
  };

  const formatTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  const getDurationMinutes = (start: string, end: string) => Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);

  // 指定日の予約をフィルタリング
  const selectedTimeline = monthBookings.filter(b => {
    const d = new Date(b.start_time);
    return d.getFullYear() === selectedDate.getFullYear() && 
           d.getMonth() === selectedDate.getMonth() && 
           d.getDate() === selectedDate.getDate() && 
           b.status !== 'cancelled' && b.status !== 'pending';
  });

  // カレンダー生成ロジック
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];
    for (let i = 0; i < firstDay.getDay(); i++) days.push(null);
    for (let i = 1; i <= lastDay.getDate(); i++) days.push(new Date(year, month, i));
    return days;
  };

  const days = getDaysInMonth(currentMonth);
  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

  if (loading && !userId) return <div className="p-6 text-center text-gray-500">読み込み中...</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex justify-between items-center pb-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">ダッシュボード</h1>
          <p className="text-gray-500 mt-1">予約状況の管理</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-md">S</div>
        </div>
      </header>

      {/* 未承認アラートセクション */}
      {pending.length > 0 && (
        <section className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-5 shadow-sm">
          {/* 既存の保留中表示 */}
          <div className="flex items-center gap-2 mb-4 text-amber-800 dark:text-amber-500 font-semibold">
            <Clock className="w-5 h-5 animate-pulse" />
            <h2>未承認の仮予約が {pending.length} 件あります</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {pending.map((booking) => (
              <div key={booking.id} className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-400" />
                    {booking.customers?.display_name || '名称未設定'}
                  </p>
                  <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4" />
                    {formatDate(booking.start_time)} {formatTime(booking.start_time)} - {formatTime(booking.end_time)}
                  </p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button onClick={() => handleReject(booking.id)} className="flex-1 sm:flex-none px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium flex items-center justify-center gap-1"><XCircle className="w-4 h-4" /> 拒否</button>
                  <button onClick={() => handleApprove(booking.id)} className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1 shadow-sm"><CheckCircle2 className="w-4 h-4" /> 承認</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        {/* 左側: カレンダー */}
        <section className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5 h-fit sticky top-6">
          <div className="flex justify-between items-center mb-6">
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-600"><ChevronLeft className="w-5 h-5"/></button>
            <h2 className="font-bold text-lg text-gray-800 dark:text-white">{currentMonth.getFullYear()}年 {currentMonth.getMonth() + 1}月</h2>
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-600"><ChevronRight className="w-5 h-5"/></button>
          </div>
          
          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekDays.map(day => (
              <div key={day} className="text-center text-xs font-semibold text-gray-400 py-1">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((date, i) => {
              if (!date) return <div key={`empty-${i}`} className="h-10"></div>;
              
              const isSelected = date.getDate() === selectedDate.getDate() && date.getMonth() === selectedDate.getMonth();
              const isToday = date.getDate() === new Date().getDate() && date.getMonth() === new Date().getMonth();
              const hasBookings = monthBookings.some(b => {
                const d = new Date(b.start_time);
                return d.getDate() === date.getDate() && d.getMonth() === date.getMonth() && b.status !== 'cancelled' && b.status !== 'pending';
              });

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(date)}
                  className={`h-10 w-full rounded-full flex flex-col items-center justify-center relative text-sm font-medium transition-all duration-200
                    ${isSelected ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300'}
                    ${isToday && !isSelected ? 'text-indigo-600 font-bold bg-indigo-50 dark:bg-indigo-900/30' : ''}
                  `}
                >
                  {date.getDate()}
                  {hasBookings && (
                    <div className={`absolute bottom-1 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-indigo-500'}`}></div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* 右側: 選択された日のタイムライン */}
        <section className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-indigo-500" />
              {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日のスケジュール
            </h2>
          </div>
          <div className="p-5 relative min-h-[300px]">
            <div className="absolute left-[88px] top-5 bottom-5 w-px bg-gray-100 dark:bg-gray-800"></div>
            
            <div className="space-y-6 relative">
              {selectedTimeline.length === 0 ? (
                <div className="text-center py-20 text-gray-500">
                  <p>この日の予約はありません。</p>
                </div>
              ) : selectedTimeline.map((item) => (
                <div key={item.id} className="flex gap-6 group cursor-pointer">
                  <div className="w-16 text-right pt-2">
                    <span className="text-sm font-medium text-gray-500">{formatTime(item.start_time)}</span>
                  </div>
                  <div className="relative flex-1">
                    <div className={`absolute -left-[30px] top-3 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
                      item.status === 'completed' ? 'bg-gray-400' : 'bg-indigo-500'
                    }`}></div>
                    
                    <div className={`p-4 rounded-xl border transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
                      item.status === 'completed' ? 'bg-gray-50 border-gray-200 dark:bg-slate-800 dark:border-gray-700 opacity-70' :
                      'bg-indigo-50/50 border-indigo-100 dark:bg-indigo-900/20 dark:border-indigo-800/50'
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

    </div>
  );
}
