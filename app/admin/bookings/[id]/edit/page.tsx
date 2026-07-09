'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, Save, Trash2 } from 'lucide-react';
import { Booking, Menu } from '@/types';
import { useMenus } from '@/hooks/useMenus';
import { useBookings } from '@/hooks/useBookings';
import { supabase } from '@/lib/supabase/client';

const hoursOptions = Array.from({ length: 24 }).map((_, i) => i.toString().padStart(2, '0'));
const minutesOptions = ['00', '15', '30', '45'];

export default function EditBookingPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  
  const { menus, fetchMenus } = useMenus(userId);
  const { updateBookingDetails, updateBookingStatus } = useBookings(userId);
  
  const [form, setForm] = useState({
    date: '',
    startHour: '10',
    startMinute: '00',
    endHour: '11',
    endMinute: '00',
    menuNote: ''
  });
  const [selectedMenuIds, setSelectedMenuIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (userId) fetchMenus();
  }, [userId, fetchMenus]);

  useEffect(() => {
    async function fetchBooking() {
      if (!params.id) return;
      setLoading(true);
      const { data, error } = await supabase
        .from('bookings')
        .select('*, customers(display_name)')
        .eq('id', params.id)
        .single();

      if (error || !data) {
        console.error(error);
        alert('予約の取得に失敗しました');
        router.back();
        return;
      }

      setBooking(data);

      const startDate = new Date(data.start_time);
      const endDate = new Date(data.end_time);

      const yyyy = startDate.getFullYear();
      const mm = String(startDate.getMonth() + 1).padStart(2, '0');
      const dd = String(startDate.getDate()).padStart(2, '0');

      setForm({
        date: `${yyyy}-${mm}-${dd}`,
        startHour: String(startDate.getHours()).padStart(2, '0'),
        startMinute: String(startDate.getMinutes()).padStart(2, '0'),
        endHour: String(endDate.getHours()).padStart(2, '0'),
        endMinute: String(endDate.getMinutes()).padStart(2, '0'),
        menuNote: data.menu_note || ''
      });

      if (data.selected_menus && Array.isArray(data.selected_menus)) {
        setSelectedMenuIds(new Set(data.selected_menus.map((m: any) => m.id)));
      } else {
        setSelectedMenuIds(new Set());
      }
      setLoading(false);
    }
    
    if (userId) {
      fetchBooking();
    }
  }, [userId, params.id, router]);

  const toggleMenu = (id: string) => {
    const newSet = new Set(selectedMenuIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedMenuIds(newSet);
  };

  const handleCalculateEndTime = () => {
    const selectedMenusList = menus.filter(m => selectedMenuIds.has(m.id));
    const totalDuration = selectedMenusList.reduce((acc, curr) => acc + curr.duration, 0);
    
    if (totalDuration === 0) return;

    const startDateTime = new Date(`${form.date}T${form.startHour}:${form.startMinute}:00`);
    const endDateTime = new Date(startDateTime.getTime() + totalDuration * 60000);
    
    setForm(prev => ({
      ...prev,
      endHour: String(endDateTime.getHours()).padStart(2, '0'),
      endMinute: String(endDateTime.getMinutes()).padStart(2, '0')
    }));
  };

  const handleSave = async () => {
    if (!booking) return;
    
    const startTimeStr = `${form.startHour}:${form.startMinute}`;
    const endTimeStr = `${form.endHour}:${form.endMinute}`;

    if (!form.date) {
      alert(`日付は必須項目です。`);
      return;
    }
    if (startTimeStr >= endTimeStr) {
      alert(`終了時間は開始時間より後に設定してください。`);
      return;
    }

    const startDateTime = new Date(`${form.date}T${startTimeStr}:00`);
    const endDateTime = new Date(`${form.date}T${endTimeStr}:00`);

    const selectedMenusList = menus.filter(m => selectedMenuIds.has(m.id));
    const totalPrice = selectedMenusList.reduce((acc, curr) => acc + curr.price, 0);

    setSaving(true);

    const { data: overlappingBlocks } = await supabase
      .from('blocked_time_slots')
      .select('id')
      .eq('stylist_id', userId)
      .lt('start_time', endDateTime.toISOString())
      .gt('end_time', startDateTime.toISOString())
      .limit(1);

    if (overlappingBlocks && overlappingBlocks.length > 0) {
      alert('指定された時間は「予約不可枠（休憩等）」としてブロックされているため変更できません。');
      setSaving(false);
      return;
    }

    try {
      await updateBookingDetails(booking.id, startDateTime.toISOString(), endDateTime.toISOString(), form.menuNote, selectedMenusList, totalPrice);
      alert('予約内容を更新しました！');
      router.back();
    } catch (err) {
      console.error(err);
      alert('予約の更新に失敗しました。');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!booking) return;
    if (confirm('この予約を削除（キャンセル）しますか？')) {
      setSaving(true);
      try {
        await updateBookingStatus(booking.id, 'cancelled');
        alert('予約を削除しました。');
        router.back();
      } catch (err) {
        console.error(err);
        alert('削除に失敗しました。');
        setSaving(false);
      }
    }
  };

  if (loading || !booking || !userId) {
    return <div className="p-6 text-center text-gray-500 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />読み込み中...</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto animate-in fade-in duration-500">
      <div className="mb-6">
        <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-600 transition font-medium">
          <ArrowLeft className="w-4 h-4" />
          戻る
        </button>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          予約の編集
        </h1>
        <p className="text-gray-500 mt-1">予約内容の変更やキャンセルを行います。</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6 sm:p-8 space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">お客様</label>
          <input type="text" value={booking.customers?.display_name || ''} disabled className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-slate-800/50 px-4 py-3 text-gray-500 cursor-not-allowed outline-none" />
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">日付</label>
          <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">メニューの選択</label>
          {menus.length === 0 ? (
            <p className="text-sm text-gray-500">登録されたメニューがありません。</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-gray-50 dark:bg-slate-800/50">
              {menus.map(menu => (
                <label key={menu.id} className="flex items-center gap-3 cursor-pointer p-2 hover:bg-gray-100 dark:hover:bg-slate-700/50 rounded-lg transition">
                  <input type="checkbox" checked={selectedMenuIds.has(menu.id)} onChange={() => toggleMenu(menu.id)} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{menu.name} <span className="text-gray-500 dark:text-gray-400 font-normal ml-2">({menu.duration}分 / ¥{menu.price.toLocaleString()})</span></span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-2 gap-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">時間</label>
            <button onClick={handleCalculateEndTime} type="button" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-lg transition w-full sm:w-auto text-center">
              メニューから終了時間を自動計算
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 flex-1">
              <select value={form.startHour} onChange={e => setForm({...form, startHour: e.target.value})} className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-2 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition text-center">
                {hoursOptions.map(h => <option key={`sh-${h}`} value={h}>{h}</option>)}
              </select>
              <span className="font-bold text-gray-400">:</span>
              <select value={form.startMinute} onChange={e => setForm({...form, startMinute: e.target.value})} className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-2 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition text-center">
                {minutesOptions.map(m => <option key={`sm-${m}`} value={m}>{m}</option>)}
              </select>
            </div>
            <span className="text-gray-500 font-bold px-1">〜</span>
            <div className="flex items-center gap-1 flex-1">
              <select value={form.endHour} onChange={e => setForm({...form, endHour: e.target.value})} className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-2 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition text-center">
                {hoursOptions.map(h => <option key={`eh-${h}`} value={h}>{h}</option>)}
              </select>
              <span className="font-bold text-gray-400">:</span>
              <select value={form.endMinute} onChange={e => setForm({...form, endMinute: e.target.value})} className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-2 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition text-center">
                {minutesOptions.map(m => <option key={`em-${m}`} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">ご要望・備考欄</label>
          <textarea 
            rows={3}
            value={form.menuNote} 
            onChange={e => setForm({...form, menuNote: e.target.value})} 
            placeholder="事前に伝えておきたいこと等" 
            className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition resize-none" 
          />
        </div>
        
        <div className="pt-6 mt-6 border-t border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="w-full sm:w-auto flex justify-center sm:justify-start">
            <button onClick={handleDelete} disabled={saving} className="w-full sm:w-auto px-6 py-3 text-red-600 dark:text-red-400 font-medium rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition flex items-center justify-center gap-2">
              <Trash2 className="w-4 h-4" /> 予約をキャンセル
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <button onClick={() => router.back()} className="w-full sm:w-auto px-6 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-50 transition">
              キャンセル
            </button>
            <button onClick={handleSave} disabled={saving} className="w-full sm:w-auto px-8 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl shadow-sm transition flex items-center justify-center gap-2">
              {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> 保存中...</> : <><Save className="w-5 h-5" /> 変更を保存</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
