'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMenus } from '@/hooks/useMenus';
import { supabase } from '@/lib/supabase/client';
import { Loader2, ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';

type Props = {
  menuId?: string; // If provided, it's edit mode
};

export default function MenuForm({ menuId }: Props) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const { menus, loading, fetchMenus, createMenu, updateMenu } = useMenus(userId);
  
  const [form, setForm] = useState({ name: '', duration: 60, price: 5000 });
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (userId) fetchMenus();
  }, [userId, fetchMenus]);

  useEffect(() => {
    if (menuId && menus.length > 0 && !initialized) {
      const menu = menus.find(m => m.id === menuId);
      if (menu) {
        setForm({ name: menu.name, duration: menu.duration, price: menu.price });
        setInitialized(true);
      }
    } else if (!menuId) {
      setInitialized(true);
    }
  }, [menuId, menus, initialized]);

  const handleSave = async () => {
    if (!form.name) {
      alert('メニュー名を入力してください');
      return;
    }
    setSaving(true);
    let success = false;
    
    if (menuId) {
      success = await updateMenu(menuId, form.name, form.duration, form.price);
    } else {
      success = await createMenu(form.name, form.duration, form.price);
    }
    
    if (success) {
      router.push('/admin/menus');
    } else {
      alert('保存に失敗しました');
      setSaving(false);
    }
  };

  if (!userId || (menuId && !initialized)) {
    return <div className="p-6 text-center text-gray-500 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />読み込み中...</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto animate-in fade-in duration-500">
      <div className="mb-6">
        <Link href="/admin/menus" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-600 transition font-medium">
          <ArrowLeft className="w-4 h-4" />
          メニュー管理に戻る
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          {menuId ? 'メニューの編集' : '新規メニュー作成'}
        </h1>
        <p className="text-gray-500 mt-1">メニューの詳細を入力して保存してください。</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6 sm:p-8 space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">メニュー名 <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({...form, name: e.target.value})}
            className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition"
            placeholder="例: カット＆カラー"
          />
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">所要時間 (分)</label>
            <select
              value={form.duration}
              onChange={e => setForm({...form, duration: parseInt(e.target.value)})}
              className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition"
            >
              {Array.from({ length: 21 }, (_, i) => i * 15).map(m => (
                <option key={m} value={m}>{m}分</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">料金 (円)</label>
            <input
              type="number"
              step="100"
              value={form.price}
              onChange={e => setForm({...form, price: parseInt(e.target.value) || 0})}
              className="w-full rounded-xl border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition"
            />
          </div>
        </div>
        
        <div className="pt-6 mt-6 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button 
            onClick={handleSave} 
            disabled={saving} 
            className="w-full sm:w-auto px-8 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl shadow-sm transition flex items-center justify-center gap-2"
          >
            {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> 保存中...</> : <><Save className="w-5 h-5" /> 保存する</>}
          </button>
        </div>
      </div>
    </div>
  );
}
