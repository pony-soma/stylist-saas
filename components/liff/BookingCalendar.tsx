'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { formatLocalDateInput } from '@/lib/utils';
import liff from '@line/liff';
import LiffMonthView from './calendar/LiffMonthView';
import TimeSlotSheet from './calendar/TimeSlotSheet';
import { Menu } from '@/types';

type DayData = { date: Date; isAvailable: boolean };

export default function LiffBookingCalendar() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [customerName, setCustomerName] = useState('お客様');
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [days, setDays] = useState<DayData[]>([]);
  const [timeSlots, setTimeSlots] = useState<{ time: string, available: boolean }[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [liffError, setLiffError] = useState<string | null>(null);

  const [stylistId, setStylistId] = useState<string | null>(null);
  const pendingRequest = useRef<{ payload: string; id: string } | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [completed, setCompleted] = useState(false);
  const [notificationUnavailable, setNotificationUnavailable] = useState(false);
  const [lineProfile, setLineProfile] = useState<{ displayName: string } | null>(null);

  const [menus, setMenus] = useState<Menu[]>([]);
  const [selectedMenuIds, setSelectedMenuIds] = useState<Set<string>>(new Set());
  const [menuNote, setMenuNote] = useState('');

  const [availabilitySettings, setAvailabilitySettings] = useState<any[]>([]);

  const generateCalendar = useCallback((baseDate: Date, settings: any[] = availabilitySettings) => {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newDays = [];
    for (let i = 1; i <= lastDay; i++) {
      const d = new Date(year, month, i);
      const yyyyMmDd = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
      const dayOfWeek = d.getDay();
      
      let isOff = false;
      const specificSetting = settings.find(s => s.specific_date === yyyyMmDd);
      if (specificSetting) {
        isOff = specificSetting.is_day_off;
      } else {
        const weekSetting = settings.find(s => s.day_of_week === dayOfWeek);
        if (weekSetting) {
          isOff = weekSetting.is_day_off;
        }
      }

      newDays.push({
        date: d,
        isAvailable: d.getTime() >= today.getTime() && !isOff,
      });
    }
    setDays(newDays);
  }, [availabilitySettings]);

  const bookingRequest = async (body: object) => {
    const token = liff.getAccessToken();
    if (!token) throw new Error('LINEのログインを確認できません。予約URLから開き直してください。');
    const response = await fetch('/api/liff/booking', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '予約情報を取得できませんでした。');
    return result;
  };

  useEffect(() => {
    const init = async () => {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
        if (!liffId) throw new Error('予約画面の準備ができていません。担当者へお問い合わせください。');
        await liff.init({ liffId });
        // LIFF's secondary redirect expands liff.state into the URL. Also accept it
        // explicitly, without choosing an arbitrary stylist when the link is invalid.
        const params = new URLSearchParams(window.location.search);
        const state = params.get('liff.state');
        const nested = state ? new URL(state, window.location.origin).searchParams : null;
        const sid = params.get('stylist') || nested?.get('stylist');
        if (!sid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) throw new Error('予約先が指定されていません。担当者から届いた予約URLを開いてください。');
        if (!liff.isLoggedIn()) {
          const redirect = new URL('/liff', window.location.origin);
          redirect.searchParams.set('stylist', sid);
          liff.login({ redirectUri: redirect.toString() });
          return;
        }
        const data = await bookingRequest({ action: 'load', stylistId: sid });
        setStylistId(sid);
        setLineProfile({ displayName: data.displayName });
        setCustomerName(data.displayName);
        setMenus(data.menus);
        setAvailabilitySettings(data.settings);
        generateCalendar(currentMonth, data.settings);
        setLoading(false);
      } catch (error) {
        setLiffError(error instanceof Error ? error.message : '予約情報を読み込めませんでした。');
        setLoading(false);
      }
    };
    void init();
    // Initialize once; calendar changes must not repeat LINE authentication.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (selectedMenuIds.size === 0) {
      alert('先にメニューを選択してください。');
      return;
    }
    
    setSelectedDate(day.date);
    setSelectedTime(null);
    setShowBottomSheet(true);

    setTimeSlots([]);
    setSubmitError('');
    let blockedSlots: { start_time: string; end_time: string }[];
    try {
      const result = await bookingRequest({ action: 'slots', stylistId, date: formatLocalDateInput(day.date) });
      blockedSlots = result.blocks;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '空き時間を取得できませんでした。');
      return;
    }

    // 選択されたメニューの合計時間を計算
    const selectedMenusList = menus.filter(m => selectedMenuIds.has(m.id));
    const totalDuration = selectedMenusList.reduce((acc, curr) => acc + curr.duration, 0);

    // 該当日の営業時間を取得
    const yyyyMmDd = `${day.date.getFullYear()}-${(day.date.getMonth()+1).toString().padStart(2, '0')}-${day.date.getDate().toString().padStart(2, '0')}`;
    const dayOfWeek = day.date.getDay();
    
    let startHour = 9;
    let endHour = 21;
    let startMin = 0;
    let endMin = 0;

    const specificSetting = availabilitySettings.find(s => s.specific_date === yyyyMmDd);
    const weekSetting = availabilitySettings.find(s => s.day_of_week === dayOfWeek);
    
    const targetSetting = specificSetting || weekSetting;
    if (targetSetting && !targetSetting.is_day_off && targetSetting.start_time && targetSetting.end_time) {
      const [sH, sM] = targetSetting.start_time.split(':').map(Number);
      const [eH, eM] = targetSetting.end_time.split(':').map(Number);
      startHour = sH;
      startMin = sM;
      endHour = eH;
      endMin = eM;
    }

    // startHourからendHourまで、15分刻みのスロットを生成
    const baseSlots: string[] = [];
    for (let h = startHour; h <= endHour; h++) {
      if (h === endHour && endMin === 0) continue; // 終了時刻ぴったりは枠に含めない
      baseSlots.push(`${h.toString().padStart(2, '0')}:00`);
      baseSlots.push(`${h.toString().padStart(2, '0')}:15`);
      baseSlots.push(`${h.toString().padStart(2, '0')}:30`);
      baseSlots.push(`${h.toString().padStart(2, '0')}:45`);
    }
    
    const calculatedSlots = baseSlots.map(timeStr => {
      const [hours, mins] = timeStr.split(':').map(Number);
      
      // 営業開始時間前、終了時間後を除外
      if (hours < startHour || (hours === startHour && mins < startMin)) return null;
      
      const slotStartTime = new Date(formatLocalDateInput(day.date) + "T" + timeStr + ":00+09:00");
      const slotEndTime = new Date(slotStartTime.getTime() + totalDuration * 60000);
      
      // 営業終了時間を越える場合は予約不可
      const endOfDayLimit = new Date(formatLocalDateInput(day.date) + 'T' + String(endHour).padStart(2,'0') + ':' + String(endMin).padStart(2,'0') + ':00+09:00');
      if (slotEndTime.getTime() > endOfDayLimit.getTime()) {
        return { time: timeStr, available: false };
      }

      // 既存の予約と被るかどうかのチェックは行わず、重複予約を許可する
      // (不可枠のチェックのみ行う)

      // 不可枠（ブロック）と被るかチェック
      const isBlocked = blockedSlots?.some(b => {
        const bStart = new Date(b.start_time).getTime();
        const bEnd = new Date(b.end_time).getTime();
        return (slotStartTime.getTime() < bEnd) && (slotEndTime.getTime() > bStart);
      });

      return {
        time: timeStr,
        available: !isBlocked && slotStartTime.getTime() > Date.now()
      };
    }).filter(Boolean) as { time: string, available: boolean }[];

    setTimeSlots(calculatedSlots);
  };

  const handleSubmit = async () => {
    if (!selectedDate || !selectedTime || !stylistId || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const details = { action: 'save', stylistId,
        startTime: new Date(formatLocalDateInput(selectedDate) + 'T' + selectedTime + ':00+09:00').toISOString(),
        menuIds: Array.from(selectedMenuIds).sort(), menuNote };
      const payload = JSON.stringify(details);
      if (pendingRequest.current?.payload !== payload) pendingRequest.current = { payload, id: crypto.randomUUID() };
      const saved = await bookingRequest({ ...details, requestId: pendingRequest.current.id });
      setNotificationUnavailable(saved.notification === 'unavailable');
      setShowBottomSheet(false);
      setCompleted(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '予約を保存できませんでした。もう一度お試しください。');
    } finally { setSubmitting(false); }
  };

  if (completed) return <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
    <h1 className="text-xl font-bold">予約リクエストを受け付けました</h1>
    <p className="mt-4">担当者の承認をお待ちください。この画面を閉じていただけます。</p>
    {notificationUnavailable && <p role="status" className="mt-4 text-amber-700">予約は保存されていますが、担当者へのLINE通知を送れませんでした。お急ぎの場合は担当者へ直接ご連絡ください。</p>}
  </div>;

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
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center bg-gray-50">
        <p className="text-red-500 font-bold mb-2">エラーが発生しました</p>
        <p className="text-sm text-gray-500 mb-4">{liffError}</p>
        <p className="text-sm text-gray-500">LINEアプリ内で開くか、URLを確認してください。</p>
      </div>
    );
  }

  const toggleMenu = (id: string) => {
    const newSet = new Set(selectedMenuIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedMenuIds(newSet);
  };

  const selectedMenusList = menus.filter(m => selectedMenuIds.has(m.id));
  const totalDuration = selectedMenusList.reduce((acc, curr) => acc + curr.duration, 0);
  const totalPrice = selectedMenusList.reduce((acc, curr) => acc + curr.price, 0);

  return (
    <div className="bg-gray-50 dark:bg-slate-950 min-h-screen w-full max-w-md mx-auto shadow-xl relative font-sans pb-24 transition-colors duration-300">
      {/* ヘッダーエリア */}
      <header className="bg-white dark:bg-slate-900 px-5 pt-8 pb-4 shadow-sm relative z-10 flex items-center justify-between border-b border-gray-100 dark:border-gray-800">
        <h1 className="font-bold text-xl text-gray-900 dark:text-white">ご予約</h1>
        {lineProfile && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{lineProfile.displayName} 様</span>
          </div>
        )}
      </header>

      <main className="p-4">
        {/* メニュー選択エリア */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl mb-4 shadow-sm border border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
            <span className="bg-indigo-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs">1</span>
            メニューの選択
          </h2>
          {menus.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">メニューが設定されていません</p>
          ) : (
            <div className="space-y-2">
              {menus.map(menu => (
                <label key={menu.id} className={`flex items-center justify-between p-3 rounded-lg border-2 transition cursor-pointer ${selectedMenuIds.has(menu.id) ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30' : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}`}>
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={selectedMenuIds.has(menu.id)} onChange={() => toggleMenu(menu.id)} className="w-5 h-5 text-indigo-600 rounded border-gray-300 dark:border-gray-600 dark:bg-slate-800 focus:ring-indigo-500" />
                    <div>
                      <p className="font-bold text-gray-900 dark:text-white">{menu.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{menu.duration}分</p>
                    </div>
                  </div>
                  <div className="font-bold text-gray-900 dark:text-white">
                    ¥{menu.price.toLocaleString()}
                  </div>
                </label>
              ))}
            </div>
          )}
          
          {selectedMenuIds.size > 0 && (
            <div className="mt-4 p-3 bg-gray-50 dark:bg-slate-800 rounded-lg flex justify-between items-center border border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-600 dark:text-gray-300 font-medium">合計: {totalDuration}分</span>
              <span className="font-bold text-lg text-indigo-600 dark:text-indigo-400">¥{totalPrice.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* 日時選択エリア */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
            <span className="bg-indigo-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs">2</span>
            日時の選択
          </h2>
          {selectedMenuIds.size === 0 && (
            <p className="text-sm text-red-500 mb-2 font-medium">※まずはメニューを選択してください</p>
          )}
          <div className={selectedMenuIds.size === 0 ? "opacity-50 pointer-events-none transition-opacity duration-300" : "transition-opacity duration-300"}>
            <div className="flex justify-between items-center mb-4 bg-gray-50 dark:bg-slate-800/50 p-2 rounded-lg border border-gray-100 dark:border-gray-800">
              <button onClick={handlePrevMonth} className="px-3 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded transition font-medium text-sm">
                先月
              </button>
              <span className="font-bold text-gray-800 dark:text-gray-200">{currentMonth.getFullYear()}年 {currentMonth.getMonth() + 1}月</span>
              <button onClick={handleNextMonth} className="px-3 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded transition font-medium text-sm">
                翌月
              </button>
            </div>

            <LiffMonthView 
              currentMonth={currentMonth}
              days={days}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              onDateClick={handleDateClick}
            />
          </div>
        </div>
      </main>

      <TimeSlotSheet 
        isOpen={showBottomSheet}
        onClose={() => setShowBottomSheet(false)}
        selectedDate={selectedDate}
        timeSlots={timeSlots}
        selectedTime={selectedTime}
        onSelectTime={setSelectedTime}
      >
        <div className="mt-4 border-t border-gray-200 dark:border-gray-800 pt-4">
          {submitError && <p role="alert" className="mb-3 text-sm text-red-700">{submitError}</p>}
          <div className="bg-gray-50 dark:bg-slate-800/50 p-3 rounded-xl mb-3 border border-gray-100 dark:border-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1 font-medium">ご予約内容</p>
            {selectedDate && selectedTime && (
              <p className="font-bold text-lg text-gray-900 dark:text-white mb-2">
                {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日 {selectedTime} 〜
              </p>
            )}
            
            <div className="mb-2 space-y-1">
              {selectedMenusList.map(menu => (
                <div key={menu.id} className="flex justify-between items-center text-sm">
                  <span className="text-gray-700">{menu.name}</span>
                  <span className="text-gray-500">¥{menu.price.toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-gray-200">
              <span className="text-sm text-indigo-600 font-bold">合計: {totalDuration}分 / ¥{totalPrice.toLocaleString()}</span>
            </div>
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-gray-700">ご要望・備考欄 (任意)</label>
            <textarea 
              className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition" 
              rows={2} 
              placeholder="事前に伝えておきたいことがあればご記入ください"
              value={menuNote}
              onChange={(e) => setMenuNote(e.target.value)}
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={!selectedTime || submitting}
            className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl disabled:bg-gray-300 disabled:cursor-not-allowed transition hover:bg-indigo-700 shadow-sm flex items-center justify-center gap-2"
          >
            {submitting ? <><Loader2 className="w-5 h-5 animate-spin" /> 処理中...</> : 'この内容で予約をリクエスト'}
          </button>
        </div>
      </TimeSlotSheet>
    </div>
  );
}
