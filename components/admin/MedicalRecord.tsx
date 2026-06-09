'use client';

import React, { useState, useEffect } from 'react';
import { User, Phone, MessageCircle, ImageIcon, Plus, Clock, Loader2, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useMedicalRecords } from '@/hooks/useMedicalRecords';
import MedicalRecordForm from './medical-record/MedicalRecordForm';
import { formatDate } from '@/lib/utils';

export default function MedicalRecordView({ customerId, onClose }: { customerId: string, onClose: () => void }) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const { records, customerInfo, loading, fetchRecords, addRecord, updateRecord, deleteRecord } = useMedicalRecords(customerId);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleCreate = async (data: any) => {
    if (!userId) return;
    await addRecord(userId, data.visit_date, data.treatment_menu, data.chemicals_used, data.notes);
    setIsCreating(false);
    fetchRecords();
  };

  const handleUpdate = async (data: any) => {
    if (!editingRecordId) return;
    await updateRecord(editingRecordId, data.visit_date, data.treatment_menu, data.chemicals_used, data.notes);
    setEditingRecordId(null);
    fetchRecords();
  };

  const handleDelete = async (recordId: string) => {
    if (confirm("このカルテを削除してもよろしいですか？")) {
      await deleteRecord(recordId);
      fetchRecords();
    }
  };

  if (loading || !customerInfo) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 flex flex-col items-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
          <p className="text-gray-500 font-medium">カルテを読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-300">
      <div className="w-full max-w-2xl bg-gray-50 dark:bg-slate-950 h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-500">
        
        {/* ヘッダー */}
        <div className="bg-white dark:bg-slate-900 p-6 shadow-sm z-10 sticky top-0">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-100 to-purple-100 dark:from-indigo-900 dark:to-purple-900 flex items-center justify-center">
                  <User className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{customerInfo.display_name}</h2>
                  <p className="text-sm text-gray-500">顧客ID: {customerInfo.id.substring(0,8)}</p>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-slate-700 transition">×</button>
          </div>
          
          <div className="flex gap-4">
            {customerInfo.phone_number && (
              <a href={`tel:${customerInfo.phone_number}`} className="flex-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 py-2 px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 transition shadow-sm">
                <Phone className="w-4 h-4 text-green-500" /> 電話する
              </a>
            )}
            <button className="flex-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 py-2 px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 transition shadow-sm">
              <MessageCircle className="w-4 h-4 text-blue-500" /> LINE送信
            </button>
          </div>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-gray-800 dark:text-gray-200 text-lg flex items-center gap-2">
              <Clock className="w-5 h-5 text-indigo-500" />
              カルテ履歴 ({records.length}件)
            </h3>
            {!isCreating && (
              <button onClick={() => setIsCreating(true)} className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-bold rounded-lg hover:bg-indigo-100 transition flex items-center gap-2 text-sm border border-indigo-100 dark:border-indigo-800/50">
                <Plus className="w-4 h-4" /> 新規カルテ
              </button>
            )}
          </div>

          {isCreating && (
            <MedicalRecordForm 
              onSubmit={handleCreate} 
              onCancel={() => setIsCreating(false)} 
            />
          )}

          <div className="space-y-6">
            {records.map((record) => (
              <div key={record.id} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
                {editingRecordId === record.id ? (
                  <MedicalRecordForm
                    initialData={record}
                    onSubmit={handleUpdate}
                    onCancel={() => setEditingRecordId(null)}
                  />
                ) : (
                  <>
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className="inline-block px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-bold rounded-full mb-2">
                          {formatDate(record.visit_date)}
                        </span>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{record.treatment_menu}</h3>
                      </div>
                      <div className="flex gap-4">
                        <button onClick={() => setEditingRecordId(record.id)} className="text-sm font-medium text-gray-500 hover:text-indigo-600 transition flex items-center gap-1">
                          <Edit2 className="w-3.5 h-3.5" /> 編集
                        </button>
                        <button onClick={() => handleDelete(record.id)} className="text-sm font-medium text-gray-400 hover:text-red-500 transition flex items-center gap-1">
                          <Trash2 className="w-3.5 h-3.5" /> 削除
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {record.chemicals_used && (
                        <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-3 rounded-lg border border-indigo-100/50 dark:border-indigo-900/30">
                          <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-1 uppercase tracking-wider">Chemicals</p>
                          <p className="text-sm text-gray-800 dark:text-gray-200">{record.chemicals_used}</p>
                        </div>
                      )}
                      {record.notes && (
                        <div className="bg-gray-50 dark:bg-slate-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Notes</p>
                          <p className="text-sm text-gray-800 dark:text-gray-200">{record.notes}</p>
                        </div>
                      )}
                    </div>

                    {record.record_photos && record.record_photos.length > 0 && (
                      <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
                        {record.record_photos.map((photo, i) => (
                          <div key={i} className="relative group rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 cursor-pointer flex-shrink-0">
                            {/* placeholder */}
                            <ImageIcon className="w-6 h-6 text-gray-300" />
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            {records.length === 0 && !isCreating && (
              <div className="text-center py-10 text-gray-500">
                <p>カルテ履歴がありません。</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
