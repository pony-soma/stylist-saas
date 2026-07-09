'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { useCustomers } from '@/hooks/useCustomers';
import { useBookings } from '@/hooks/useBookings';
import { useMenus } from '@/hooks/useMenus';
import { supabase } from '@/lib/supabase/client';

const hoursOptions = Array.from({ length: 24 }).map((_, i) => i.toString().padStart(2, '0'));
const minutesOptions = ['00', '15', '30', '45'];

function ProxyBookingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get('date');

  const [userId, setUserId] = useState<string | null>(null);
  
  const { proxyCustomers, fetchProxyCustomers } = useCustomers(userId);
  const { createProxyBooking } = useBookings(userId);
  const { menus, fetchMenus } = useMenus(userId);
  
  const [form, setForm] = useState({ 
    customerId: '', 
    date: dateParam || new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0], 
    startHour: '10', 
    startMinute: '00', 
    endHour: '11', 
    endMinute: '00', 
    menuNote: '' 
  });
  
  const [selectedMenuIds, setSelectedMenuIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (userId) {
      fetchProxyCustomers().then(customers => {
        if (customers && customers.length > 0 && !form.customerId) {
          setForm(prev => ({ ...prev, customerId: customers[0].id }));
        }
        setInitialized(true);
      });
      fetchMenus();
    }
  }, [userId, fetchProxyCustomers, fetchMenus]); // Removed form.customerId from deps to avoid infinite loops

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
    const startTimeStr = `${form.startHour}:${form.startMinute}`;
    const endTimeStr = `${form.endHour}:${form.endMinute}`;
    const finalCustomerId = form.customerId || (proxyCustomers.length > 0 ? proxyCustomers[0].id : '');

    if (!finalCustomerId || !form.date) {
      alert(`お客様と日付は必須項目です。`);
      return;
    }
    if (startTimeStr >= endTimeStr) {
      alert(`終了時間は開始時間より後に設定してください。`);
      return;
    }

    const selectedMenusList = menus.filter(m => selectedMenuIds.has(m.id));
    const totalPrice = selectedMenusList.reduce((acc, curr) => acc + curr.price, 0);
    const startDateTime = new Date(`${form.date}T${startTimeStr}:00`);
    const endDateTime = new Date(`${form.date}T${endTimeStr}:00`);

    setSaving(true);

    const { data: overlappingBlocks } = await supabase
      .from('blocked_time_slots')
      .select('id')
      .eq('stylist_id', userId)
      .lt('start_time', endDateTime.toISOString())
      .gt('end_time', startDateTime.toISOString())
      .limit(1);

    if (overlappingBlocks && overlappingBlocks.length > 0) {
      alert('指定された時間は「予約不可枠（休憩等）」としてブロックされているため予約できません。');
      setSaving(false);
      return;
    }

    try {
      await createProxyBooking(finalCustomerId, form.date, startTimeStr, endTimeStr, form.menuNote, selectedMenusList, totalPrice);
      alert('代理予約を作成しました！');
      router.back();
    } catch (err) {
      console.error(err);
      alert('予約作成に失敗しました。');
      setSaving(false);
    }
  };

  if (!userId || !initialized) {
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
          代理予約の作成
        </h1>
        <p className="text-gray-500 mt-1">電話などから受けた予約を代わりに入力します。</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6 sm:p-8 space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">お客様 (過去の予約から選択)</label>
          {proxyCustomers.length === 0 ? (
            <p className="text-sm text-red-500">過去の顧客データがありません。</p>
          ) : (
            <select 
              value={form.customerId}
              onChange={e => setForm({...form, customerId: e.target.value})}
              className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition"
            >
              {proxyCustomers.map(c => (
                <option key={c.id} value={c.id}>{c.display_name}</option>
              ))}
            </select>
          )}
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">日付</label>
          <input 
            type="date" 
            value={form.date} 
            onChange={e => setForm({...form, date: e.target.value})} 
            className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition" 
          />
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
        
        <div className="pt-6 mt-6 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
          <button onClick={() => router.back()} className="w-full sm:w-auto px-6 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-50 transition">
            キャンセル
          </button>
          <button onClick={handleSave} disabled={saving || proxyCustomers.length === 0} className="w-full sm:w-auto px-8 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl shadow-sm transition flex items-center justify-center gap-2">
            {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> 保存中...</> : <><Save className="w-5 h-5" /> 予約を確定</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProxyBookingPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-gray-500 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />読み込み中...</div>}>
      <ProxyBookingForm />
    </Suspense>
  );
}
