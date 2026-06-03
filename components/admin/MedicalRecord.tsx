'use client';

import React, { useState, useEffect } from 'react';
import { User, Phone, MessageCircle, CalendarPlus, UploadCloud, Image as ImageIcon, Plus, Clock, Loader2, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type RecordPhoto = {
  storage_path: string;
};

type MedicalRecord = {
  id: string;
  visit_date: string;
  treatment_menu: string;
  chemicals_used: string;
  notes: string;
  record_photos: RecordPhoto[];
};

type CustomerInfo = {
  id: string;
  display_name: string;
  phone_number: string;
  created_at: string;
};

export default function MedicalRecordView({ customerId, onClose }: { customerId: string, onClose: () => void }) {
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  
  // フォーム用State
  const [menu, setMenu] = useState('');
  const [chemicals, setChemicals] = useState('');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // 代理予約用State
  const [isCreatingBooking, setIsCreatingBooking] = useState(false);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [bookingMenu, setBookingMenu] = useState('');
  const [savingBooking, setSavingBooking] = useState(false);
  const [stylistId, setStylistId] = useState<string | null>(null);

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
      
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setStylistId(user.id);

      // propsの顧客IDを利用
      const { data: custData, error: custError } = await supabase
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
      // 1. カルテデータの保存
      const { data: recordData, error: recordError } = await supabase
        .from('medical_records')
        .insert({
          customer_id: customer.id,
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
          .from('record_photos')
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
      setIsCreating(false);
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
    if (!confirm('本当にこのカルテを削除しますか？\n（紐づく写真も表示されなくなります）')) return;
    try {
      const { error } = await supabase.from('medical_records').delete().eq('id', recordId);
      if (error) throw error;
      setRecords(records.filter(r => r.id !== recordId));
    } catch (error) {
      console.error('Failed to delete record:', error);
      alert('削除に失敗しました。');
    }
  };

  const handleCreateProxyBooking = async () => {
    if (!customer || !stylistId) return;
    if (!bookingDate || !bookingTime || !bookingMenu) {
      alert('日付、時間、メニューを入力してください');
      return;
    }
    
    setSavingBooking(true);
    try {
      // 日時を結合してISO文字列にする
      const startDateTime = new Date(`${bookingDate}T${bookingTime}:00`);
      // 終了時間は適当に1時間後に設定（必要に応じてフォームで入力させることも可能）
      const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

      const { error } = await supabase
        .from('bookings')
        .insert({
          customer_id: customer.id,
          stylist_id: stylistId,
          start_time: startDateTime.toISOString(),
          end_time: endDateTime.toISOString(),
          menu_note: bookingMenu,
          status: 'confirmed', // 代理予約は確定済みとする
        });

      if (error) throw error;

      alert('代理予約を作成しました！');
      setIsCreatingBooking(false);
      setBookingDate('');
      setBookingTime('');
      setBookingMenu('');
    } catch (error) {
      console.error('Failed to create proxy booking:', error);
      alert('予約の作成に失敗しました。');
    } finally {
      setSavingBooking(false);
    }
  };

  // 写真の公開URLを取得するヘルパー関数
  const getPhotoUrl = (path: string) => {
    return supabase.storage.from('record_photos').getPublicUrl(path).data.publicUrl;
  };

  if (loading) return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-xl flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <p className="text-gray-500 font-medium">読み込み中...</p>
      </div>
    </div>
  );

  if (!customer) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex justify-center items-start overflow-y-auto pt-10 pb-10 px-4 animate-in fade-in duration-200">
      <div className="bg-gray-50 dark:bg-slate-950 w-full max-w-6xl rounded-2xl shadow-2xl relative animate-in slide-in-from-bottom-10 duration-300 overflow-hidden border border-gray-200 dark:border-gray-800">
        
        {/* モーダルのヘッダー (閉じるボタン) */}
        <div className="sticky top-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center z-10">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">顧客カルテ</h2>
          <button 
            onClick={onClose}
            className="w-10 h-10 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full flex items-center justify-center transition-colors"
          >
            <Plus className="w-6 h-6 rotate-45" />
          </button>
        </div>

        <div className="p-6">
          <div className="flex flex-col lg:flex-row gap-8">
        
        {/* 左側: 顧客プロファイル */}
        <div className="lg:w-1/3 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6 sticky top-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-pink-400 to-rose-400 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-md">
                {customer.display_name.charAt(0)}
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{customer.display_name}</h2>
              </div>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                <Phone className="w-4 h-4 text-gray-400" />
                {customer.phone_number || '未登録'}
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                <Clock className="w-4 h-4 text-gray-400" />
                来店回数: {records.length}回
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button 
                onClick={() => setIsCreatingBooking(!isCreatingBooking)}
                className="w-full py-2.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 font-medium rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition"
              >
                <CalendarPlus className="w-4 h-4" />
                {isCreatingBooking ? 'キャンセル' : '代理予約を作成'}
              </button>

              {isCreatingBooking && (
                <div className="mt-4 p-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-gray-700 space-y-4 animate-in fade-in slide-in-from-top-2">
                  <h3 className="font-bold text-sm text-gray-900 dark:text-white">新規予約</h3>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">日付</label>
                    <input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} className="w-full rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">時間</label>
                    <input type="time" value={bookingTime} onChange={e => setBookingTime(e.target.value)} className="w-full rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">メニュー・備考</label>
                    <input type="text" value={bookingMenu} onChange={e => setBookingMenu(e.target.value)} placeholder="カット＋カラー" className="w-full rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                  </div>
                  <button onClick={handleCreateProxyBooking} disabled={savingBooking} className="w-full py-2 mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm shadow-sm transition flex items-center justify-center gap-2">
                    {savingBooking ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中...</> : '予約を確定する'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右側: カルテ履歴 & 新規作成 */}
        <div className="lg:w-2/3 space-y-6">
          <div className="flex justify-between items-center pb-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">カルテ履歴</h2>
            <button 
              onClick={() => setIsCreating(!isCreating)}
              className="px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium rounded-lg flex items-center gap-2 hover:opacity-90 transition shadow-sm"
            >
              {isCreating ? 'キャンセル' : <><Plus className="w-4 h-4" /> 新規カルテ</>}
            </button>
          </div>

          {/* 新規作成フォーム */}
          {isCreating && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-indigo-100 dark:border-indigo-900/50 p-6 animate-in slide-in-from-top-4 duration-300">
              <h3 className="text-lg font-bold mb-4">新規カルテ作成</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">メニュー</label>
                  <input type="text" value={menu} onChange={e => setMenu(e.target.value)} placeholder="カット ＋ カラー" className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">使用薬剤</label>
                  <textarea rows={2} value={chemicals} onChange={e => setChemicals(e.target.value)} placeholder="カラー剤のレシピ等..." className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">メモ (会話内容・次回提案)</label>
                  <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="お客様の要望や気になったこと..." className="w-full rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" />
                </div>
                
                {/* 画像アップロードエリア */}
                <div className="mt-2 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 flex flex-col items-center justify-center text-gray-500 transition relative overflow-hidden">
                  <input type="file" multiple accept="image/*" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  <UploadCloud className="w-8 h-8 text-indigo-500 mb-2" />
                  <p className="font-medium">施術写真を追加</p>
                  <p className="text-sm mt-1">{selectedFiles.length > 0 ? `${selectedFiles.length}個のファイルを選択済み` : 'クリックまたはドラッグ＆ドロップ'}</p>
                </div>

                <div className="flex justify-end pt-4">
                  <button onClick={handleSaveRecord} disabled={uploading} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl shadow-sm transition flex items-center gap-2">
                    {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中...</> : '保存する'}
                  </button>
                </div>
              </div>
            </div>
          )}

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
      </div>
    </div>
  );
}
