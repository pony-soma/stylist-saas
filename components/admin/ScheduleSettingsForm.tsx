'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAvailability, AvailabilitySetting } from '@/hooks/useAvailability';
import { Loader2, ArrowLeft, Save, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';

const DAYS_OF_WEEK = [
  { id: 0, name: '日曜日' },
  { id: 1, name: '月曜日' },
  { id: 2, name: '火曜日' },
  { id: 3, name: '水曜日' },
  { id: 4, name: '木曜日' },
  { id: 5, name: '金曜日' },
  { id: 6, name: '土曜日' },
];

export default function ScheduleSettingsForm() {
  const [userId, setUserId] = useState<string | null>(null);
  const { settings, loading, fetchAvailability, upsertSetting, deleteSetting } = useAvailability(userId);
  const [saving, setSaving] = useState(false);

  // Local state for regular week settings
  const [weekSettings, setWeekSettings] = useState<Record<number, Partial<AvailabilitySetting>>>({});
  // Local state for specific date overrides
  const [specificSettings, setSpecificSettings] = useState<AvailabilitySetting[]>([]);

  // New specific date form state
  const [newDate, setNewDate] = useState('');
  const [newDateIsDayOff, setNewDateIsDayOff] = useState(true);
  const [newDateStart, setNewDateStart] = useState('09:00');
  const [newDateEnd, setNewDateEnd] = useState('21:00');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (userId) fetchAvailability();
  }, [userId, fetchAvailability]);

  // Load data into local state
  useEffect(() => {
    if (settings.length > 0) {
      const week: Record<number, Partial<AvailabilitySetting>> = {};
      const specific: AvailabilitySetting[] = [];

      settings.forEach(s => {
        if (s.day_of_week !== null) {
          week[s.day_of_week] = s;
        } else if (s.specific_date !== null) {
          specific.push(s);
        }
      });

      // Initialize missing days with default
      DAYS_OF_WEEK.forEach(d => {
        if (!week[d.id]) {
          week[d.id] = {
            day_of_week: d.id,
            is_day_off: false,
            start_time: '09:00:00',
            end_time: '21:00:00',
          };
        }
      });

      setWeekSettings(week);
      setSpecificSettings(specific);
    } else {
      // Empty state, fill defaults
      const week: Record<number, Partial<AvailabilitySetting>> = {};
      DAYS_OF_WEEK.forEach(d => {
        week[d.id] = {
          day_of_week: d.id,
          is_day_off: false,
          start_time: '09:00:00',
          end_time: '21:00:00',
        };
      });
      setWeekSettings(week);
    }
  }, [settings]);

  const handleWeekChange = (dayId: number, field: keyof AvailabilitySetting, value: any) => {
    setWeekSettings(prev => ({
      ...prev,
      [dayId]: {
        ...prev[dayId],
        [field]: value
      }
    }));
  };

  const handleSaveAll = async () => {
    setSaving(true);
    let success = true;
    for (const dayId of Object.keys(weekSettings)) {
      const setting = weekSettings[Number(dayId)];
      const res = await upsertSetting(setting);
      if (!res) success = false;
    }
    
    if (success) {
      alert('保存しました！');
      fetchAvailability();
    } else {
      alert('一部の保存に失敗しました。');
    }
    setSaving(false);
  };

  const handleAddSpecificDate = async () => {
    if (!newDate) return alert('日付を選択してください');
    setSaving(true);
    const setting: Partial<AvailabilitySetting> = {
      specific_date: newDate,
      is_day_off: newDateIsDayOff,
      start_time: newDateIsDayOff ? null : `${newDateStart}:00`,
      end_time: newDateIsDayOff ? null : `${newDateEnd}:00`,
    };
    const success = await upsertSetting(setting);
    if (success) {
      setNewDate('');
      fetchAvailability();
    } else {
      alert('追加に失敗しました。');
    }
    setSaving(false);
  };

  const handleDeleteSpecificDate = async (id: string) => {
    if (confirm('この特定日設定を削除しますか？')) {
      const success = await deleteSetting(id);
      if (success) fetchAvailability();
    }
  };

  if (!userId || loading && settings.length === 0) {
    return <div className="p-6 text-center text-gray-500 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />読み込み中...</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-500">
      <div className="mb-6">
        <Link href="/admin/settings" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-600 transition font-medium">
          <ArrowLeft className="w-4 h-4" />
          設定一覧に戻る
        </Link>
      </div>

      <div className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">営業時間・定休日設定</h1>
          <p className="text-gray-500 mt-1">基本の営業時間と定休日の設定、および臨時休業等の管理を行います。</p>
        </div>
        <button
          onClick={handleSaveAll}
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium transition flex items-center gap-2 shadow-sm disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          設定を保存
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* レギュラー設定 */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-slate-800/30">
            <h2 className="font-bold text-gray-900 dark:text-white">基本のスケジュール</h2>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {DAYS_OF_WEEK.map(day => {
              const current = weekSettings[day.id] || {};
              const isOff = current.is_day_off || false;
              
              return (
                <div key={day.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 w-32">
                    <span className={`font-medium ${day.id === 0 ? 'text-red-500' : day.id === 6 ? 'text-blue-500' : 'text-gray-700 dark:text-gray-200'}`}>
                      {day.name}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3 flex-1 justify-end">
                    <label className="flex items-center gap-2 cursor-pointer mr-2">
                      <input 
                        type="checkbox" 
                        className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-300"
                        checked={isOff}
                        onChange={(e) => handleWeekChange(day.id, 'is_day_off', e.target.checked)}
                      />
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">定休日</span>
                    </label>

                    {!isOff && (
                      <div className="flex items-center gap-2">
                        <input 
                          type="time" 
                          className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-slate-800"
                          value={current.start_time?.substring(0, 5) || '09:00'}
                          onChange={(e) => handleWeekChange(day.id, 'start_time', `${e.target.value}:00`)}
                        />
                        <span className="text-gray-400">~</span>
                        <input 
                          type="time" 
                          className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-slate-800"
                          value={current.end_time?.substring(0, 5) || '21:00'}
                          onChange={(e) => handleWeekChange(day.id, 'end_time', `${e.target.value}:00`)}
                        />
                      </div>
                    )}
                    {isOff && (
                      <div className="text-sm text-gray-400 italic">お休み</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 臨時設定 */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden flex flex-col">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-slate-800/30">
            <h2 className="font-bold text-gray-900 dark:text-white">特定日（臨時休業・臨時営業）</h2>
            <p className="text-xs text-gray-500 mt-1">基本のスケジュールを上書きします</p>
          </div>
          
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/30">
            <div className="flex flex-col gap-3">
              <input 
                type="date" 
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-slate-800"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="isOff"
                    checked={newDateIsDayOff}
                    onChange={() => setNewDateIsDayOff(true)}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium">臨時休業</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="isOff"
                    checked={!newDateIsDayOff}
                    onChange={() => setNewDateIsDayOff(false)}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium">臨時営業</span>
                </label>
              </div>
              
              {!newDateIsDayOff && (
                <div className="flex items-center gap-2">
                  <input 
                    type="time" 
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-slate-800"
                    value={newDateStart}
                    onChange={(e) => setNewDateStart(e.target.value)}
                  />
                  <span className="text-gray-400">~</span>
                  <input 
                    type="time" 
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-slate-800"
                    value={newDateEnd}
                    onChange={(e) => setNewDateEnd(e.target.value)}
                  />
                </div>
              )}
              
              <button
                onClick={handleAddSpecificDate}
                disabled={saving || !newDate}
                className="mt-2 w-full bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white px-4 py-2 rounded-lg font-medium transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                追加する
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-5">
            {specificSettings.length === 0 ? (
              <div className="text-center text-sm text-gray-500 py-4">特定日の設定はありません</div>
            ) : (
              <div className="space-y-3">
                {specificSettings.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-gray-100 dark:border-gray-700">
                    <div>
                      <div className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        {s.specific_date}
                        {s.is_day_off ? (
                          <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">休業</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">営業</span>
                        )}
                      </div>
                      {!s.is_day_off && (
                        <div className="text-sm text-gray-500 mt-1">
                          {s.start_time?.substring(0, 5)} ~ {s.end_time?.substring(0, 5)}
                        </div>
                      )}
                    </div>
                    <button 
                      onClick={() => handleDeleteSpecificDate(s.id)}
                      className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
