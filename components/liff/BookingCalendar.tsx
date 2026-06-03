'use client';

import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, X, Clock, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import liff from '@line/liff';

export default function LiffBookingCalendar() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [days, setDays] = useState<{ date: Date, isAvailable: boolean }[]>([]);
  const [timeSlots, setTimeSlots] = useState<{ time: string, available: boolean }[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [liffError, setLiffError] = useState<string | null>(null);

  const [stylistId, setStylistId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [lineProfile, setLineProfile] = useState<{ displayName: string; userId: string } | null>(null);

  useEffect(() => {
    const initLiff = async () => {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
        if (!liffId) throw new Error("LIFF ID が設定されていません");

        await liff.init({ liffId });
        
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        setLineProfile(profile);

        // LINEのユーザーIDから顧客情報を取得、または新規作成
        let { data: customer } = await supabase
          .from('customers')
          .select('id')
          .eq('line_user_id', profile.userId)
          .single();

        if (!customer) {
          const { data: newCustomer, error: insertError } = await supabase
            .from('customers')
            .insert({
              line_user_id: profile.userId,
              display_name: profile.displayName,
              // phone_number等は別途フォームで取得するフローが必要ですが今回は省略
            })
            .select()
            .single();
            
          if (insertError) throw insertError;
          customer = newCustomer;
        }
        
        setCustomerId(customer!.id);

        // URLパラメータから美容師IDを取得 (?stylist=xxx)
        const searchParams = new URLSearchParams(window.location.search);
        let targetStylistId = searchParams.get('stylist');

        if (targetStylistId) {
          // パラメータが指定された場合、その美容師の存在確認
          const { data: sData } = await supabase
            .from('stylists')
            .select('id')
            .eq('id', targetStylistId)
            .single();
            
          if (sData) {
            setStylistId(sData.id);
          } else {
            console.error('指定された美容師が見つかりませんでした');
          }
        } else {
          // SaaS化後はパラメータ必須が望ましいが、テスト時の互換性のために
          // パラメータがない場合は一番新しく登録された美容師にフォールバックする
          const { data: sData } = await supabase
            .from('stylists')
            .select('id')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          if (sData) setStylistId(sData.id);
        }

        generateCalendar(currentMonth);
        setLoading(false);

      } catch (err: any) {
        console.error("LIFF Init Error:", err);
        setLiffError(err.message);
        setLoading(false);
      }
    };

    initLiff();
  }, []);

  const generateCalendar = (baseDate: Date) => {
    const newDays = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return {
        date: d,
        isAvailable: true,
      };
    });
    setDays(newDays);
  };

  const handleDateClick = async (day: { date: Date, isAvailable: boolean }) => {
    if (!day.isAvailable || !stylistId) return;
    setSelectedDate(day.date);
    setSelectedTime(null);
    setShowBottomSheet(true);

    const startOfDay = new Date(day.date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(day.date);
    endOfDay.setHours(23, 59, 59, 999);

    const { data: bookings } = await supabase
      .from('bookings')
      .select('start_time, end_time')
      .eq('stylist_id', stylistId)
      .gte('start_time', startOfDay.toISOString())
      .lte('start_time', endOfDay.toISOString())
      .neq('status', 'cancelled');

    const baseSlots = ['10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
    
    const calculatedSlots = baseSlots.map(timeStr => {
      const [hours, mins] = timeStr.split(':').map(Number);
      const slotTime = new Date(day.date);
      slotTime.setHours(hours, mins, 0, 0);
      
      const isBooked = bookings?.some(b => {
        const bStart = new Date(b.start_time);
        return bStart.getTime() === slotTime.getTime();
      });

      return {
        time: timeStr,
        available: !isBooked
      };
    });

    setTimeSlots(calculatedSlots);
  };

  const handleSubmit = async () => {
    if (!selectedDate || !selectedTime || !stylistId || !customerId) return;
    setSubmitting(true);

    const [hours, mins] = selectedTime.split(':').map(Number);
    const startDateTime = new Date(selectedDate);
    startDateTime.setHours(hours, mins, 0, 0);
    
    const endDateTime = new Date(startDateTime);
    endDateTime.setHours(hours + 1, mins, 0, 0);

    const { error } = await supabase
      .from('bookings')
      .insert({
        customer_id: customerId,
        stylist_id: stylistId,
        start_time: startDateTime.toISOString(),
        end_time: endDateTime.toISOString(),
        status: 'pending',
        menu_note: 'LIFFからのWeb予約'
      });

    setSubmitting(false);

    if (error) {
      alert('予約リクエストに失敗しました。');
    } else {
      alert('仮予約を受け付けました！LINEのメッセージをご確認ください。');
      setShowBottomSheet(false);
      setSelectedTime(null);
      // 予約完了メッセージをLINEトークに送信することも可能
      if (liff.isInClient()) {
        liff.closeWindow();
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
        <p className="text-gray-500">LINE認証を確認中...</p>
      </div>
    );
  }

  if (liffError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-red-50 text-red-600 p-6 rounded-2xl shadow-sm text-center">
          <p className="font-bold mb-2">エラーが発生しました</p>
          <p className="text-sm">{liffError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen w-full max-w-md mx-auto shadow-xl relative overflow-hidden font-sans">
      <header className="bg-white px-5 pt-8 pb-4 shadow-sm relative z-10 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-gray-900">空き状況・予約</h1>
        {lineProfile && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">{lineProfile.displayName}</span>
          </div>
        )}
      </header>

      <main className="p-5">
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <button className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-600 active:scale-95 transition-transform">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-indigo-500" />
              {currentMonth.getFullYear()}年 {currentMonth.getMonth() + 1}月
            </h2>
            <button className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-600 active:scale-95 transition-transform">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-2 mb-2">
            {['日', '月', '火', '水', '木', '金', '土'].map(day => (
              <div key={day} className="text-center text-xs font-semibold text-gray-400 py-1">
                {day}
              </div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 gap-2">
            {days.length > 0 && Array.from({ length: days[0].date.getDay() }).map((_, i) => (
              <div key={`empty-${i}`} className="h-10"></div>
            ))}
            
            {days.map((day, i) => (
              <button
                key={i}
                onClick={() => handleDateClick(day)}
                disabled={!day.isAvailable}
                className={`h-10 w-full rounded-full flex items-center justify-center text-sm font-medium transition-all duration-200 active:scale-90
                  ${day.isAvailable 
                    ? 'text-gray-700 bg-gray-50 hover:bg-indigo-50 hover:text-indigo-600 border border-transparent' 
                    : 'text-gray-300 opacity-50 cursor-not-allowed'
                  }
                `}
              >
                {day.date.getDate()}
              </button>
            ))}
          </div>
        </div>
      </main>

      {/* ボトムシート オーバーレイ */}
      <div 
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 z-40 max-w-md mx-auto ${
          showBottomSheet ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setShowBottomSheet(false)}
      />

      {/* 時間選択ボトムシート */}
      <div 
        className={`fixed bottom-0 w-full max-w-md mx-auto bg-white rounded-t-3xl shadow-2xl transition-transform duration-500 z-50 p-6 flex flex-col ${
          showBottomSheet ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ maxHeight: '80vh' }}
      >
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6"></div>
        
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-900">
            {selectedDate ? `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日 (${['日', '月', '火', '水', '木', '金', '土'][selectedDate.getDay()]})` : ''}
          </h3>
          <button 
            onClick={() => setShowBottomSheet(false)}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 pr-2 space-y-3 pb-24">
          {timeSlots.map((slot, i) => (
            <button
              key={i}
              disabled={!slot.available}
              onClick={() => setSelectedTime(slot.time)}
              className={`w-full py-4 px-5 rounded-2xl flex justify-between items-center transition-all active:scale-[0.98]
                ${!slot.available ? 'bg-gray-50 opacity-50 cursor-not-allowed' : 
                  selectedTime === slot.time 
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' 
                    : 'bg-white border border-gray-200 text-gray-700 hover:border-indigo-300'
                }
              `}
            >
              <span className="font-bold flex items-center gap-2 text-lg">
                <Clock className="w-5 h-5 opacity-70" /> {slot.time}
              </span>
              {slot.available ? (
                <span className={`text-sm font-medium ${selectedTime === slot.time ? 'text-indigo-100' : 'text-indigo-600'}`}>
                  選択
                </span>
              ) : (
                <span className="text-sm text-gray-400">× 満席</span>
              )}
            </button>
          ))}
        </div>

        <div className="absolute bottom-0 left-0 w-full p-5 bg-gradient-to-t from-white via-white to-transparent pt-10">
          <button 
            onClick={handleSubmit}
            disabled={!selectedTime || submitting}
            className={`w-full py-4 rounded-2xl font-bold text-lg shadow-lg transition-all active:scale-[0.98] flex justify-center items-center gap-2
              ${selectedTime && !submitting
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200' 
                : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
              }
            `}
          >
            {submitting ? <><Loader2 className="w-5 h-5 animate-spin" /> 送信中...</> : '予約リクエストを送信'}
          </button>
        </div>
      </div>
    </div>
  );
}
