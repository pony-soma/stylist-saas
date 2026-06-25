import React, { useState, useEffect } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import { useCustomers } from '@/hooks/useCustomers';
import { useBookings } from '@/hooks/useBookings';
import { useMenus } from '@/hooks/useMenus';
import { Menu } from '@/types';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onSuccess: () => void;
  selectedDate: Date;
};

const hoursOptions = Array.from({ length: 24 }).map((_, i) => i.toString().padStart(2, '0'));
const minutesOptions = ['00', '15', '30', '45'];

export default function ProxyBookingModal({ isOpen, onClose, userId, onSuccess, selectedDate }: Props) {
  const { proxyCustomers, fetchProxyCustomers } = useCustomers(userId);
  const { createProxyBooking } = useBookings(userId);
  const { menus, fetchMenus } = useMenus(userId);
  
  const [form, setForm] = useState({ 
    customerId: '', 
    date: selectedDate ? new Date(selectedDate.getTime() - selectedDate.getTimezoneOffset() * 60000).toISOString().split('T')[0] : '', 
    startHour: '10', 
    startMinute: '00', 
    endHour: '11', 
    endMinute: '00', 
    menuNote: '' 
  });
  const [selectedMenuIds, setSelectedMenuIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm(prev => ({ 
        ...prev, 
        date: selectedDate ? new Date(selectedDate.getTime() - selectedDate.getTimezoneOffset() * 60000).toISOString().split('T')[0] : prev.date 
      }));
      fetchProxyCustomers().then(customers => {
        if (customers && customers.length > 0 && !form.customerId) {
          setForm(prev => ({ ...prev, customerId: customers[0].id }));
        }
      });
      fetchMenus();
    }
  }, [isOpen, fetchProxyCustomers, fetchMenus, selectedDate, form.customerId]);

  if (!isOpen) return null;

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
      alert(`お客様と日付は必須項目です。 (Customer: ${!!finalCustomerId}, Date: ${!!form.date})`);
      return;
    }
    if (startTimeStr >= endTimeStr) {
      alert(`終了時間は開始時間より後に設定してください。(${startTimeStr} >= ${endTimeStr})`);
      return;
    }

    const selectedMenusList = menus.filter(m => selectedMenuIds.has(m.id));
    const totalPrice = selectedMenusList.reduce((acc, curr) => acc + curr.price, 0);

    setSaving(true);
    try {
      await createProxyBooking(finalCustomerId, form.date, startTimeStr, endTimeStr, form.menuNote, selectedMenusList, totalPrice);
      alert('代理予約を作成しました！');
      setForm({ customerId: proxyCustomers[0]?.id || '', date: '', startHour: '10', startMinute: '00', endHour: '11', endMinute: '00', menuNote: '' });
      setSelectedMenuIds(new Set());
      onSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      alert('予約作成に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100 dark:border-gray-800 flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center shrink-0">
          <h3 className="font-bold text-lg">代理予約の作成</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><XCircle className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">お客様 (過去の予約から選択)</label>
            {proxyCustomers.length === 0 ? (
              <p className="text-sm text-red-500">過去の顧客データがありません。</p>
            ) : (
              <select 
                value={form.customerId}
                onChange={e => setForm({...form, customerId: e.target.value})}
                className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition"
              >
                {proxyCustomers.map(c => (
                  <option key={c.id} value={c.id}>{c.display_name}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">日付</label>
            <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">メニューの選択</label>
            {menus.length === 0 ? (
              <p className="text-sm text-gray-500">登録されたメニューがありません。</p>
            ) : (
              <div className="space-y-2 max-h-32 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2 bg-gray-50 dark:bg-slate-800/50">
                {menus.map(menu => (
                  <label key={menu.id} className="flex items-center gap-2 cursor-pointer p-1">
                    <input type="checkbox" checked={selectedMenuIds.has(menu.id)} onChange={() => toggleMenu(menu.id)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                    <span className="text-sm text-gray-800 dark:text-gray-200">{menu.name} ({menu.duration}分 / ¥{menu.price.toLocaleString()})</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex justify-between items-end mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">時間</label>
              <button onClick={handleCalculateEndTime} type="button" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium bg-indigo-50 px-2 py-1 rounded">
                メニューから終了時間を自動計算
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 flex-1">
                <select value={form.startHour} onChange={e => setForm({...form, startHour: e.target.value})} className="w-16 rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-2 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition text-center">
                  {hoursOptions.map(h => <option key={`sh-${h}`} value={h}>{h}</option>)}
                </select>
                <span className="font-bold">:</span>
                <select value={form.startMinute} onChange={e => setForm({...form, startMinute: e.target.value})} className="w-16 rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-2 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition text-center">
                  {minutesOptions.map(m => <option key={`sm-${m}`} value={m}>{m}</option>)}
                </select>
              </div>
              <span className="text-gray-500 font-bold px-1">〜</span>
              <div className="flex items-center gap-1 flex-1">
                <select value={form.endHour} onChange={e => setForm({...form, endHour: e.target.value})} className="w-16 rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-2 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition text-center">
                  {hoursOptions.map(h => <option key={`eh-${h}`} value={h}>{h}</option>)}
                </select>
                <span className="font-bold">:</span>
                <select value={form.endMinute} onChange={e => setForm({...form, endMinute: e.target.value})} className="w-16 rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-2 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition text-center">
                  {minutesOptions.map(m => <option key={`em-${m}`} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">ご要望・備考欄</label>
            <input type="text" value={form.menuNote} onChange={e => setForm({...form, menuNote: e.target.value})} placeholder="事前に伝えておきたいこと等" className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
          </div>
        </div>
        <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 transition">キャンセル</button>
          <button onClick={handleSave} disabled={saving || proxyCustomers.length === 0} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-sm transition flex items-center gap-2">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中...</> : '予約を確定'}
          </button>
        </div>
      </div>
    </div>
  );
}
