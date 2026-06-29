'use client';

import React, { useState, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronRight, ChevronLeft, Link as LinkIcon, CalendarPlus, Clock, Pencil, Settings, Menu as MenuIcon, UserCog } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import MedicalRecordView from '@/components/admin/MedicalRecord';
import ProxyBookingModal from './dashboard/ProxyBookingModal';
import EditBookingModal from './dashboard/EditBookingModal';
import PendingBookingsList from './dashboard/PendingBookingsList';
import { useBookings } from '@/hooks/useBookings';
import { formatTime, getDurationMinutes } from '@/lib/utils';
import { Booking } from '@/types';

export default function AdminDashboard() {
  const [userId, setUserId] = useState<string | null>(null);
  
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [isProxyModalOpen, setIsProxyModalOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);

  const { pending, monthBookings, loading, fetchBookings, updateBookingStatus, updateBookingDetails } = useBookings(userId);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (userId) {
      fetchBookings(currentMonth);
    }
  }, [userId, currentMonth, fetchBookings]);

  const handleApprove = async (id: string) => {
    if (await updateBookingStatus(id, 'confirmed')) {
      fetchBookings(currentMonth);
    } else {
      alert("承認に失敗しました");
    }
  };

  const handleReject = async (id: string) => {
    if (await updateBookingStatus(id, 'cancelled')) {
      fetchBookings(currentMonth);
    }
  };

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
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-white">LiNo Dashboard</h1>
          <p className="text-sm sm:text-base text-gray-500 mt-1">予約状況の管理</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {userId && (
            <div className="hidden md:block text-right mr-2">
              <p className="text-xs text-gray-500 font-medium">あなた専用の予約URL（LINEに設定）</p>
              <div className="mt-1 flex justify-end">
                <button
                  className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 dark:text-indigo-400 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors font-medium border border-indigo-100 dark:border-indigo-800 shadow-sm"
                  onClick={() => {
                    const liffId = process.env.NEXT_PUBLIC_LIFF_ID || '未設定';
                    navigator.clipboard.writeText(`https://liff.line.me/${liffId}?stylist=${userId}`);
                    alert('予約URLをコピーしました！LINEのリッチメニュー等に設定してください。');
                  }}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  予約URLをコピー
                </button>
              </div>
            </div>
          )}
          
          <Link 
            href="/admin/schedule" 
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-full transition-all shadow-sm"
          >
            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>カレンダー</span>
          </Link>

          <Link 
            href="/admin/settings"  
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-full transition-all shadow-sm"
          >
            <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500 dark:text-slate-400" />
            <span>設定</span>
          </Link>

          <div className="w-9 h-9 sm:w-10 sm:h-10 ml-1 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-md text-sm sm:text-base">S</div>
        </div>
      </header>

      {/* 未承認予約リスト */}
      <PendingBookingsList 
        pending={pending} 
        onApprove={handleApprove} 
        onReject={handleReject} 
        onSelectCustomer={setSelectedCustomerId} 
      />

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
            <button 
              onClick={() => setIsProxyModalOpen(true)}
              className="text-sm px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 dark:text-indigo-400 font-medium rounded-lg flex items-center gap-2 transition border border-indigo-200 dark:border-indigo-800"
            >
              <CalendarPlus className="w-4 h-4" />
              代理予約
            </button>
          </div>
          <div className="p-5 relative min-h-[300px]">
            <div className="absolute left-[88px] top-5 bottom-5 w-px bg-gray-100 dark:bg-gray-800"></div>
            
            <div className="space-y-6 relative">
              {selectedTimeline.length === 0 ? (
                <div className="text-center py-20 text-gray-500">
                  <p>この日の予約はありません。</p>
                </div>
              ) : selectedTimeline.map((item) => (
                <div key={item.id} onClick={() => setSelectedCustomerId(item.customer_id)} className="flex gap-6 group cursor-pointer">
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
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-bold text-gray-900 dark:text-white">{item.customers?.display_name}</h3>
                            {item.source === 'proxy' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                                代理予約
                              </span>
                            )}
                            {item.source === 'liff' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                                Web予約
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2 text-sm text-gray-500 mt-2 flex-wrap">
                            {item.selected_menus && item.selected_menus.length > 0 ? (
                              item.selected_menus.map(menu => (
                                <span key={menu.id} className="bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-full text-xs font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
                                  {menu.name}
                                </span>
                              ))
                            ) : null}
                            {item.menu_note && (
                              <span className="flex items-center gap-1 text-xs">
                                <span className="w-1 h-1 bg-gray-400 rounded-full mx-1"></span>
                                {item.menu_note}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-2 font-medium flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {getDurationMinutes(item.start_time, item.end_time)}分
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.status === 'confirmed' && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingBooking(item);
                                }}
                                className="text-xs font-bold px-3 py-1.5 rounded-lg text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition border border-indigo-100 dark:bg-indigo-900/20 dark:border-indigo-900/30 dark:hover:bg-indigo-900/40"
                              >
                                編集
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm(`${item.customers?.display_name}様の予約をキャンセルしますか？`)) {
                                    updateBookingStatus(item.id, 'cancelled').then(() => fetchBookings(currentMonth));
                                  }
                                }}
                                className="text-xs font-bold px-3 py-1.5 rounded-lg text-red-600 bg-red-50 hover:bg-red-100 transition border border-red-100 dark:bg-red-900/20 dark:border-red-900/30 dark:hover:bg-red-900/40"
                              >
                                キャンセル
                              </button>
                            </>
                          )}
                          <ChevronRight className="w-5 h-5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* カルテ表示モーダル */}
      {selectedCustomerId && (
        <MedicalRecordView customerId={selectedCustomerId} onClose={() => setSelectedCustomerId(null)} />
      )}

      {/* 代理予約モーダル */}
      {userId && (
        <ProxyBookingModal 
          isOpen={isProxyModalOpen} 
          onClose={() => setIsProxyModalOpen(false)} 
          userId={userId} 
          onSuccess={() => fetchBookings(currentMonth)}
          selectedDate={selectedDate}
        />
      )}

      {/* 予約編集モーダル */}
      <EditBookingModal 
        isOpen={!!editingBooking} 
        onClose={() => setEditingBooking(null)}
        booking={editingBooking}
        onSave={async (id, start, end, menuNote, selectedMenus, totalPrice) => {
          if (await updateBookingDetails(id, start, end, menuNote, selectedMenus, totalPrice)) {
            fetchBookings(currentMonth);
          } else {
            throw new Error('Update failed');
          }
        }}
        userId={userId!}
      />
    </div>
  );
}
