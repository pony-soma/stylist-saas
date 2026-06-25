'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useMenus } from '@/hooks/useMenus';
import { Plus, Edit2, Trash2, Loader2 } from 'lucide-react';
import { Menu } from '@/types';

export default function MenuManager() {
  const [userId, setUserId] = useState<string | null>(null);
  const { menus, loading, fetchMenus, createMenu, updateMenu, deleteMenu } = useMenus(userId);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
  const [form, setForm] = useState({ name: '', duration: 60, price: 5000 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (userId) fetchMenus();
  }, [userId, fetchMenus]);

  const openModal = (menu?: Menu) => {
    if (menu) {
      setEditingMenu(menu);
      setForm({ name: menu.name, duration: menu.duration, price: menu.price });
    } else {
      setEditingMenu(null);
      setForm({ name: '', duration: 60, price: 5000 });
    }
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name) {
      alert('メニュー名を入力してください');
      return;
    }
    setSaving(true);
    let success = false;
    if (editingMenu) {
      success = await updateMenu(editingMenu.id, form.name, form.duration, form.price);
    } else {
      success = await createMenu(form.name, form.duration, form.price);
    }
    
    if (success) {
      await fetchMenus();
      setIsModalOpen(false);
    } else {
      alert('保存に失敗しました');
    }
    setSaving(false);
  };

  const handleDelete = async (menu: Menu) => {
    if (confirm(`「${menu.name}」を削除してもよろしいですか？`)) {
      const success = await deleteMenu(menu.id);
      if (success) {
        await fetchMenus();
      } else {
        alert('削除に失敗しました');
      }
    }
  };

  if (loading && !menus.length) {
    return <div className="p-6 text-center text-gray-500">読み込み中...</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-500">
      <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">メニュー管理</h1>
          <p className="text-gray-500 mt-1">提供するメニューと料金・所要時間を設定します</p>
        </div>
        <button
          onClick={() => openModal()}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition flex items-center gap-2 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          新規メニュー
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
        {menus.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            登録されているメニューがありません。<br/>新規メニューを追加してください。
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-gray-800">
                <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">メニュー名</th>
                <th className="p-4 font-semibold text-gray-600 dark:text-gray-300 w-32">所要時間</th>
                <th className="p-4 font-semibold text-gray-600 dark:text-gray-300 w-32">料金</th>
                <th className="p-4 font-semibold text-gray-600 dark:text-gray-300 w-24 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {menus.map((menu) => (
                <tr key={menu.id} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition">
                  <td className="p-4 font-medium text-gray-900 dark:text-white">{menu.name}</td>
                  <td className="p-4 text-gray-600 dark:text-gray-400">{menu.duration}分</td>
                  <td className="p-4 text-gray-600 dark:text-gray-400">¥{menu.price.toLocaleString()}</td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openModal(menu)}
                        className="p-1.5 text-gray-400 hover:text-indigo-600 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded transition"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(menu)}
                        className="p-1.5 text-gray-400 hover:text-red-600 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100 dark:border-gray-800">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-bold text-lg">{editingMenu ? 'メニューの編集' : '新規メニュー作成'}</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">メニュー名</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="例: カット"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">所要時間 (分)</label>
                  <select
                    value={form.duration}
                    onChange={e => setForm({...form, duration: parseInt(e.target.value)})}
                    className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  >
                    {[30, 60, 90, 120, 150, 180, 210, 240].map(m => (
                      <option key={m} value={m}>{m}分</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">料金 (円)</label>
                  <input
                    type="number"
                    step="100"
                    value={form.price}
                    onChange={e => setForm({...form, price: parseInt(e.target.value) || 0})}
                    className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 transition">
                キャンセル
              </button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg shadow-sm transition flex items-center gap-2">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中...</> : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
