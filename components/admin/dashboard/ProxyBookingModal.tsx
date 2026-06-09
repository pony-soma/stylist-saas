import React, { useState, useEffect } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import { useCustomers } from '@/hooks/useCustomers';
import { useBookings } from '@/hooks/useBookings';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onSuccess: () => void;
  selectedDate: Date;
};

export default function ProxyBookingModal({ isOpen, onClose, userId, onSuccess, selectedDate }: Props) {
  const { proxyCustomers, fetchProxyCustomers } = useCustomers(userId);
  const { createProxyBooking } = useBookings(userId);
  
  const [form, setForm] = useState({ 
    customerId: '', 
    date: selectedDate ? new Date(selectedDate.getTime() - selectedDate.getTimezoneOffset() * 60000).toISOString().split('T')[0] : '', 
    startTime: '10:00', 
    endTime: '11:00', 
    menu: '' 
  });
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
    }
  }, [isOpen, fetchProxyCustomers, selectedDate, form.customerId]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!form.customerId || !form.date || !form.startTime || !form.endTime || !form.menu) {
      alert('すべての項目を入力してください');
      return;
    }
    if (form.startTime >= form.endTime) {
      alert('終了時間は開始時間より後に設定してください');
      return;
    }
    setSaving(true);
    try {
      await createProxyBooking(form.customerId, form.date, form.startTime, form.endTime, form.menu);
      alert('代理予約を作成しました！');
      setForm({ customerId: proxyCustomers[0]?.id || '', date: '', startTime: '10:00', endTime: '11:00', menu: '' });
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
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100 dark:border-gray-800">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
          <h3 className="font-bold text-lg">代理予約の作成</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><XCircle className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
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
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">時間</label>
            <div className="flex items-center gap-2">
              <input type="time" step="900" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} className="flex-1 rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
              <span className="text-gray-500">〜</span>
              <input type="time" step="900" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} className="flex-1 rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">メニュー・備考</label>
            <input type="text" value={form.menu} onChange={e => setForm({...form, menu: e.target.value})} placeholder="カット＋カラー" className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
          </div>
        </div>
        <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 transition">キャンセル</button>
          <button onClick={handleSave} disabled={saving || proxyCustomers.length === 0} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-sm transition flex items-center gap-2">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中...</> : '予約を確定'}
          </button>
        </div>
      </div>
    </div>
  );
}
