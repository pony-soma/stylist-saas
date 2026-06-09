import React, { useState } from 'react';
import { CalendarPlus, UploadCloud, Loader2 } from 'lucide-react';

type Props = {
  initialData?: {
    visit_date: string;
    treatment_menu: string;
    chemicals_used: string;
    notes: string;
  };
  onSubmit: (data: { visit_date: string; treatment_menu: string; chemicals_used: string; notes: string }) => Promise<void>;
  onCancel: () => void;
};

export default function MedicalRecordForm({ initialData, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState(initialData || {
    visit_date: new Date().toISOString().split('T')[0],
    treatment_menu: '',
    chemicals_used: '',
    notes: ''
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.treatment_menu) {
      alert("メニューを入力してください");
      return;
    }
    setSaving(true);
    try {
      await onSubmit(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`p-5 rounded-2xl border transition-all ${initialData ? 'bg-indigo-50/50 border-indigo-100 dark:bg-indigo-900/20 dark:border-indigo-800' : 'bg-white dark:bg-slate-800 shadow-sm border-gray-200 dark:border-gray-700'}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">来店日</label>
            <input type="date" value={form.visit_date} onChange={e => setForm({...form, visit_date: e.target.value})} className="w-full bg-gray-50 dark:bg-slate-900 border-0 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">メニュー <span className="text-red-400">*</span></label>
            <input type="text" value={form.treatment_menu} onChange={e => setForm({...form, treatment_menu: e.target.value})} placeholder="例: カット＋カラー" className="w-full bg-gray-50 dark:bg-slate-900 border-0 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">使用薬剤・カラーレシピ</label>
          <textarea value={form.chemicals_used} onChange={e => setForm({...form, chemicals_used: e.target.value})} rows={2} className="w-full bg-gray-50 dark:bg-slate-900 border-0 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 resize-none"></textarea>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">メモ・会話内容</label>
          <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={3} className="w-full bg-gray-50 dark:bg-slate-900 border-0 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 resize-none"></textarea>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">写真</label>
          <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center bg-gray-50 dark:bg-slate-900/50 hover:bg-gray-100 dark:hover:bg-slate-900 transition cursor-pointer">
            <UploadCloud className="w-6 h-6 text-gray-400 mx-auto mb-2" />
            <p className="text-xs text-gray-500 font-medium">クリックまたはドラッグ＆ドロップでアップロード</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-700/50 mt-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800 rounded-lg transition">キャンセル</button>
          <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition flex items-center gap-2">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中...</> : <><CalendarPlus className="w-4 h-4" /> {initialData ? '更新する' : '保存する'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
