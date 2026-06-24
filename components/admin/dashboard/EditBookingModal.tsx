import React, { useState, useEffect } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import { Booking } from '@/types';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  booking: Booking | null;
  onSave: (id: string, startTime: string, endTime: string, menuNote: string) => Promise<void>;
};

const hoursOptions = Array.from({ length: 24 }).map((_, i) => i.toString().padStart(2, '0'));
const minutesOptions = ['00', '15', '30', '45'];

export default function EditBookingModal({ isOpen, onClose, booking, onSave }: Props) {
  const [form, setForm] = useState({
    date: '',
    startHour: '10',
    startMinute: '00',
    endHour: '11',
    endMinute: '00',
    menu: ''
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && booking) {
      const startDate = new Date(booking.start_time);
      const endDate = new Date(booking.end_time);

      const yyyy = startDate.getFullYear();
      const mm = String(startDate.getMonth() + 1).padStart(2, '0');
      const dd = String(startDate.getDate()).padStart(2, '0');

      setForm({
        date: `${yyyy}-${mm}-${dd}`,
        startHour: String(startDate.getHours()).padStart(2, '0'),
        startMinute: String(startDate.getMinutes()).padStart(2, '0'),
        endHour: String(endDate.getHours()).padStart(2, '0'),
        endMinute: String(endDate.getMinutes()).padStart(2, '0'),
        menu: booking.menu_note || ''
      });
    }
  }, [isOpen, booking]);

  if (!isOpen || !booking) return null;

  const handleSave = async () => {
    const startTimeStr = `${form.startHour}:${form.startMinute}`;
    const endTimeStr = `${form.endHour}:${form.endMinute}`;

    if (!form.date) {
      alert('日付は必須項目です');
      return;
    }
    if (startTimeStr >= endTimeStr) {
      alert('終了時間は開始時間より後に設定してください');
      return;
    }

    const startDateTime = new Date(`${form.date}T${startTimeStr}:00`);
    const endDateTime = new Date(`${form.date}T${endTimeStr}:00`);

    setSaving(true);
    try {
      await onSave(booking.id, startDateTime.toISOString(), endDateTime.toISOString(), form.menu);
      alert('予約内容を更新しました！');
      onClose();
    } catch (err) {
      console.error(err);
      alert('予約の更新に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100 dark:border-gray-800">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
          <h3 className="font-bold text-lg">予約の編集</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><XCircle className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">お客様</label>
            <input type="text" value={booking.customers?.display_name || ''} disabled className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-slate-800/50 px-4 py-2 text-gray-500 cursor-not-allowed outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">日付</label>
            <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">時間</label>
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
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">メニュー・備考</label>
            <input type="text" value={form.menu} onChange={e => setForm({...form, menu: e.target.value})} placeholder="カット＋カラー" className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
          </div>
        </div>
        <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 transition">キャンセル</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-sm transition flex items-center gap-2">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中...</> : '変更を保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
