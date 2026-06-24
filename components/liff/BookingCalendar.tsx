'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import liff from '@line/liff';
import LiffMonthView from './calendar/LiffMonthView';
import TimeSlotSheet from './calendar/TimeSlotSheet';

type DayData = { date: Date; isAvailable: boolean };

export default function LiffBookingCalendar() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [days, setDays] = useState<DayData[]>([]);
  const [timeSlots, setTimeSlots] = useState<{ time: string, available: boolean }[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [liffError, setLiffError] = useState<string | null>(null);

  const [stylistId, setStylistId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [lineProfile, setLineProfile] = useState<{ displayName: string; userId: string } | null>(null);

  const generateCalendar = useCallback((baseDate: Date) => {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newDays = [];
    for (let i = 1; i <= lastDay; i++) {
      const d = new Date(year, month, i);
      newDays.push({
        date: d,
        isAvailable: d.getTime() >= today.getTime(), // 今日以降のみ予約可能
      });
    }
    setDays(newDays);
  }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generateCalendar]);

  const handlePrevMonth = () => {
    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    setCurrentMonth(newMonth);
    generateCalendar(newMonth);
  };

  const handleNextMonth = () => {
    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    setCurrentMonth(newMonth);
    generateCalendar(newMonth);
  };

  const handleDateClick = async (day: DayData) => {
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
        menu_note: 'LIFFからのWeb予約',
        source: 'liff'
      });

    setSubmitting(false);

    if (error) {
      alert('予約リクエストに失敗しました。');
    } else {
      alert('仮予約を受け付けました！LINEのメッセージをご確認ください。');
      setShowBottomSheet(false);
      setSelectedTime(null);
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
        <LiffMonthView 
          currentMonth={currentMonth}
          days={days}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
          onDateClick={handleDateClick}
        />
      </main>

      <TimeSlotSheet 
        isOpen={showBottomSheet}
        onClose={() => setShowBottomSheet(false)}
        selectedDate={selectedDate}
        timeSlots={timeSlots}
        selectedTime={selectedTime}
        onSelectTime={setSelectedTime}
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </div>
  );
}
