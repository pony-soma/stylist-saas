'use client';

import React, { useState, useEffect } from 'react';
import { User, Phone, MessageCircle, UploadCloud, Plus, Loader2, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { MedicalRecord, CustomerInfo } from '@/types';

export default function MedicalRecordView({ customerId, onClose }: { customerId: string, onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  
  // フォーム用State
  const [menu, setMenu] = useState('');
  const [chemicals, setChemicals] = useState('');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // 編集用State
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    visit_date: '',
    treatment_menu: '',
    chemicals_used: '',
    notes: ''
  });

  useEffect(() => {
    const fetchCustomerAndRecords = async () => {
      setLoading(true);

      // propsの顧客IDを利用
      const { data: custData } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single();

      if (custData) {
        setCustomer(custData);
        
        // その顧客のカルテを取得
        const { data: recData } = await supabase
          .from('medical_records')
          .select('id, visit_date, treatment_menu, chemicals_used, notes, record_photos(storage_path)')
          .eq('customer_id', custData.id)
          .order('visit_date', { ascending: false });
          
        if (recData) {
          setRecords(recData as unknown as MedicalRecord[]);
        }
      }
      setLoading(false);
    };

    fetchCustomerAndRecords();
  }, [customerId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleSaveRecord = async () => {
    if (!customer) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // 1. カルテデータの保存
      const { data: recordData, error: recordError } = await supabase
        .from('medical_records')
        .insert({
          customer_id: customer.id,
          stylist_id: user?.id,
          visit_date: new Date().toISOString().split('T')[0],
          treatment_menu: menu,
          chemicals_used: chemicals,
          notes: notes,
        })
        .select()
        .single();

      if (recordError || !recordData) throw recordError;

      // 2. 画像のアップロード
      const photoPromises = selectedFiles.map(async (file) => {
        const fileExt = file.name.split('.').pop();
        const fileName = `${recordData.id}-${Math.random()}.${fileExt}`;
        const filePath = `records/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('record-photos')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // 3. 写真パスをDBに保存
        await supabase
          .from('record_photos')
          .insert({
            record_id: recordData.id,
            storage_path: filePath
          });
      });

      await Promise.all(photoPromises);

      // リセットと再取得
      setMenu(''); setChemicals(''); setNotes(''); setSelectedFiles([]);
      
      // レコード一覧の更新処理
      const { data: newData } = await supabase
        .from('medical_records')
        .select('id, visit_date, treatment_menu, chemicals_used, notes, record_photos(storage_path)')
        .eq('customer_id', customer.id)
        .order('visit_date', { ascending: false });
      
      if (newData) setRecords(newData as unknown as MedicalRecord[]);

    } catch (error) {
      console.error('Failed to save record:', error);
      alert('カルテの保存に失敗しました。');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveEdit = async (recordId: string) => {
    if (!customer) return;
    setSavingEdit(true);
    try {
      const { error } = await supabase
        .from('medical_records')
        .update({
          visit_date: editForm.visit_date,
          treatment_menu: editForm.treatment_menu,
          chemicals_used: editForm.chemicals_used,
          notes: editForm.notes,
        })
        .eq('id', recordId);

      if (error) throw error;

      // Update local state without fetching all again
      setRecords(records.map(r => r.id === recordId ? { ...r, ...editForm } : r));
      setEditingRecordId(null);
    } catch (error) {
      console.error('Failed to update record:', error);
      alert('カルテの更新に失敗しました。');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!confirm('本当にこのカルテを削除しますか？\n紐づく写真も表示されなくなります！')) return;
    try {
      const { error } = await supabase.from('medical_records').delete().eq('id', recordId);
      if (error) throw error;
      setRecords(records.filter(r => r.id !== recordId));
    } catch (error) {
      console.error('Failed to delete record:', error);
      alert('削除に失敗しました。');
    }
  };

  const getPhotoUrl = (path: string) => {
    const { data } = supabase.storage.from('record-photos').getPublicUrl(path);
    return data.publicUrl;
  };

  if (loading || !customer) {
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
        
        {/* ヘッダー部分 */}
        <div className="bg-white dark:bg-slate-900 p-6 shadow-sm z-10 sticky top-0">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-100 to-purple-100 dark:from-indigo-900 dark:to-purple-900 flex items-center justify-center">
                  <User className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{customer.display_name}</h2>
                  <p className="text-sm text-gray-500">顧客ID: {customer.id.substring(0,8)}</p>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-slate-700 transition">×</button>
          </div>
          
          <div className="flex gap-4">
            {customer.phone_number && (
              <a href={`tel:${customer.phone_number}`} className="flex-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 py-2 px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 transition shadow-sm">
                <Phone className="w-4 h-4 text-green-500" /> 電話する
              </a>
            )}
            <button className="flex-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 py-2 px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 transition shadow-sm">
              <MessageCircle className="w-4 h-4 text-blue-500" /> LINE送信
            </button>
          </div>
        </div>

        {/* スクロール領域 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* 追加フォーム */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-indigo-500" /> カルテを追加
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">メニュー <span className="text-red-500">*</span></label>
                <input type="text" value={menu} onChange={e => setMenu(e.target.value)} placeholder="例: カット＋カラー" className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">使用薬剤・カラーレシピ</label>
                <textarea rows={2} value={chemicals} onChange={e => setChemicals(e.target.value)} className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">メモ・会話内容</label>
                <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
              </div>

              <div className="relative border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-6 text-center hover:bg-gray-50 dark:hover:bg-slate-800 transition">
                <input type="file" multiple accept="image/*" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <UploadCloud className="w-8 h-8 text-indigo-500 mb-2" />
                <p className="font-medium">施術写真を追加</p>
                <p className="text-sm mt-1">{selectedFiles.length > 0 ? `${selectedFiles.length}個のファイルを選択済み` : 'クリックまたはドラッグ＆ドロップ'}</p>
              </div>

              <div className="flex justify-end pt-4">
                <button onClick={handleSaveRecord} disabled={uploading || !menu} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl shadow-sm transition flex items-center gap-2">
                  {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中...</> : '保存する'}
                </button>
              </div>
            </div>
          </div>

          {/* カルテタイムライン */}
          <div className="space-y-6">
            {records.length === 0 ? (
              <p className="text-gray-500 text-center py-10">カルテ履歴がありません。</p>
            ) : records.map((record) => (
              <div key={record.id} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
                
                {editingRecordId === record.id ? (
                  <div className="space-y-4 animate-in fade-in">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold">カルテを編集</h3>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">来店日</label>
                      <input type="date" value={editForm.visit_date} onChange={e => setEditForm({...editForm, visit_date: e.target.value})} className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">メニュー</label>
                      <input type="text" value={editForm.treatment_menu} onChange={e => setEditForm({...editForm, treatment_menu: e.target.value})} className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">使用薬剤</label>
                      <textarea rows={2} value={editForm.chemicals_used} onChange={e => setEditForm({...editForm, chemicals_used: e.target.value})} className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">メモ</label>
                      <textarea rows={3} value={editForm.notes} onChange={e => setEditForm({...editForm, notes: e.target.value})} className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                      <button onClick={() => setEditingRecordId(null)} className="px-5 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition">キャンセル</button>
                      <button onClick={() => handleSaveEdit(record.id)} disabled={savingEdit} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition flex items-center gap-2">
                        {savingEdit ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中...</> : '更新する'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className="inline-block px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-bold rounded-full mb-2">
                          {record.visit_date}
                        </span>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{record.treatment_menu}</h3>
                      </div>
                      <div className="flex gap-4">
                        <button 
                          onClick={() => {
                            setEditingRecordId(record.id);
                            setEditForm({
                              visit_date: record.visit_date,
                              treatment_menu: record.treatment_menu,
                              chemicals_used: record.chemicals_used || '',
                              notes: record.notes || ''
                            });
                          }} 
                          className="text-sm font-medium text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition flex items-center gap-1"
                        >
                          <Edit2 className="w-3.5 h-3.5" /> 編集
                        </button>
                        <button onClick={() => handleDeleteRecord(record.id)} className="text-sm font-medium text-gray-400 hover:text-red-500 transition flex items-center gap-1">
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
                            <img src={getPhotoUrl(photo.storage_path)} alt={`施術写真 ${i+1}`} className="w-24 h-24 object-cover group-hover:scale-105 transition-transform duration-300" />
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
