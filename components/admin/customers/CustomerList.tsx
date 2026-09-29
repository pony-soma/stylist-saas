'use client';

import React, { useState, useEffect } from 'react';
import { ChevronLeft, Search, User, Phone, Calendar, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { CustomerInfo } from '@/types';

export default function CustomerList() {
  const [userId, setUserId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [listError, setListError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    display_name: '',
    phone_number: '',
    birth_date: '',
    gender: 'unspecified',
    memo: ''
  });

  useEffect(() => {
    const fetchUserAndCustomers = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = '/login';
        return;
      }
      setUserId(session.user.id);
      
      // 担当関係を基準に、予約前の新規顧客も取得する。
      const { data: relationships, error: relationshipError } = await supabase.from('stylist_customers').select('customer_id, archived_at').eq('stylist_id', session.user.id);
      if (relationshipError) {
        setListError('顧客一覧を取得できませんでした。時間をおいて再読み込みしてください。');
        setLoading(false);
        return;
      }
      setArchivedIds(new Set(relationships?.filter(r => r.archived_at).map(r => r.customer_id)));
      const { data: memos } = await supabase.from('customer_memos').select('customer_id, birth_date, gender').eq('stylist_id', session.user.id);
      
      const customerIds = new Set<string>();
      relationships?.forEach(r => customerIds.add(r.customer_id));

      if (customerIds.size > 0) {
        const { data: customersData } = await supabase
          .from('customers')
          .select('id, display_name, phone_number, line_picture_url, line_user_id, created_at')
          .in('id', Array.from(customerIds))
          .order('created_at', { ascending: false });

        if (customersData) {
          const memoMap = new Map();
          memos?.forEach(m => memoMap.set(m.customer_id, m));

          const mergedCustomers = customersData.map(c => ({
            ...c,
            birth_date: memoMap.get(c.id)?.birth_date || null,
            gender: memoMap.get(c.id)?.gender || 'unspecified'
          }));
          setCustomers(mergedCustomers);
        }
      } else {
        setCustomers([]);
      }
      setLoading(false);
    };

    fetchUserAndCustomers();
  }, []);

  const visibleCustomers = customers.filter(c => archivedIds.has(c.id) === showArchived);
  const filteredCustomers = visibleCustomers.filter(c =>
    c.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone_number?.includes(searchTerm)
  );

  const changeArchive = async (customer: CustomerInfo) => {
    if (updatingId) return;
    const archived = !archivedIds.has(customer.id);
    if (!window.confirm(archived
      ? `${customer.display_name}さんを顧客一覧から削除しますか？予約・カルテ・写真は残り、予約もキャンセルされません。「削除済み」から復元できます。`
      : `${customer.display_name}さんを顧客一覧に復元しますか？`)) return;
    setUpdatingId(customer.id);
    setListError('');
    try {
      const response = await fetch('/api/customers/archive', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customer.id, archived }),
      });
      if (!response.ok) throw new Error('Update failed');
      setArchivedIds(current => {
        const next = new Set(current);
        if (archived) next.add(customer.id); else next.delete(customer.id);
        return next;
      });
    } catch {
      setListError('変更結果を確認できませんでした。再読み込みして状態をご確認ください。');
    } finally { setUpdatingId(null); }
  };

  const calculateAge = (birthDate: string | null | undefined) => {
    if (!birthDate) return null;
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  };

  const translateGender = (gender: string | undefined) => {
    if (gender === 'male') return '男性';
    if (gender === 'female') return '女性';
    if (gender === 'other') return 'その他';
    return null;
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating || !userId || !newCustomer.display_name.trim()) return;
    setIsCreating(true);

    try {
      const response = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCustomer),
      });
      if (!response.ok) {
        alert(response.status === 403 ? '顧客の登録には有効なプランが必要です。' : '顧客の登録に失敗しました。入力内容を確認してください。');
        return;
      }

      setShowNewCustomerModal(false);
      setNewCustomer({ display_name: '', phone_number: '', birth_date: '', gender: 'unspecified', memo: '' });
      // ページをリロードして反映させるのが確実
      window.location.reload();
    } catch (error) {
      console.error(error);
      alert('顧客の登録に失敗しました。');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex items-center gap-4 pb-4 border-b border-gray-200 dark:border-gray-800">
        <Link 
          href="/admin" 
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition shadow-sm"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">顧客一覧</h1>
          <p className="text-sm text-gray-500 mt-1">{showArchived ? '削除済み' : '登録中'} {visibleCustomers.length} 名</p>
        </div>
        <button 
          onClick={() => setShowNewCustomerModal(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 transition shadow-sm whitespace-nowrap"
        >
          ＋ 新規追加
        </button>
      </header>

      <div className="flex flex-wrap gap-2" aria-label="顧客の表示切り替え">
        {[false, true].map(archived => (
          <button key={String(archived)} type="button" aria-pressed={showArchived === archived}
            onClick={() => setShowArchived(archived)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${showArchived === archived ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-200'}`}>
            {archived ? '削除済み' : '登録中'}
          </button>
        ))}
      </div>
      {showArchived && <p className="text-sm text-gray-500">記録は保存されています。「復元」で通常の一覧に戻せます。</p>}
      {listError && <p role="alert" className="text-sm text-red-600">{listError}</p>}
      {/* 検索バー */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input 
          type="text" 
          placeholder="名前や電話番号で検索..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white transition"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-gray-800">
          <User className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">顧客が見つかりません</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCustomers.map(customer => (
            <div 
              key={customer.id} 
              className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800/50 cursor-pointer transition flex items-center gap-4 group"
            >
              <div className="w-14 h-14 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center shrink-0 border border-indigo-100 dark:border-indigo-800 overflow-hidden">
                {customer.line_picture_url ? (
                  <img src={customer.line_picture_url} alt={customer.display_name} className="w-full h-full object-cover" />
                ) : (
                  <User className="w-6 h-6 text-indigo-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3><Link href={`/admin/customers/${customer.id}`} className="block font-bold text-gray-900 dark:text-white truncate hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                  {customer.display_name}
                </Link></h3>
                <div className="flex items-center flex-wrap gap-2 mt-1.5 text-xs text-gray-500">
                  {customer.phone_number ? (
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3"/> {customer.phone_number}</span>
                  ) : (
                    <span className="text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3"/>未登録</span>
                  )}
                  {calculateAge(customer.birth_date) !== null && (
                    <span className="bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300 font-medium">
                      {calculateAge(customer.birth_date)}歳
                    </span>
                  )}
                  {translateGender(customer.gender) && (
                    <span className="bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300 font-medium">
                      {translateGender(customer.gender)}
                    </span>
                  )}
                </div>
                <button type="button" disabled={updatingId !== null}
                  onClick={() => changeArchive(customer)}
                  className="mt-3 min-h-11 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 dark:border-gray-700 disabled:opacity-50">
                  {updatingId === customer.id ? '処理中…' : showArchived ? '復元' : '一覧から削除'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新規顧客登録モーダル */}
      {showNewCustomerModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-800">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">新規顧客を登録</h3>
              <p className="text-xs text-gray-500 mt-1">お客様情報を手動で追加します。</p>
            </div>
            
            <form onSubmit={handleCreateCustomer} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  お名前 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={50}
                  value={newCustomer.display_name}
                  onChange={(e) => setNewCustomer({...newCustomer, display_name: e.target.value})}
                  className="w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="例：山田 花子"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  電話番号
                </label>
                <input
                  type="tel"
                  maxLength={15}
                  value={newCustomer.phone_number}
                  onChange={(e) => setNewCustomer({...newCustomer, phone_number: e.target.value})}
                  className="w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="090-1234-5678"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="min-w-0">
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">生年月日</label>
                  <input
                    type="date"
                    value={newCustomer.birth_date}
                    onChange={(e) => setNewCustomer({...newCustomer, birth_date: e.target.value})}
                    className="block box-border min-w-0 max-w-full appearance-none w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[46px]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">性別</label>
                  <select
                    value={newCustomer.gender}
                    onChange={(e) => setNewCustomer({...newCustomer, gender: e.target.value})}
                    className="w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none min-h-[46px]"
                  >
                    <option value="unspecified">未回答</option>
                    <option value="female">女性</option>
                    <option value="male">男性</option>
                    <option value="other">その他</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  専用メモ
                </label>
                <textarea
                  maxLength={5000}
                  value={newCustomer.memo}
                  onChange={(e) => setNewCustomer({...newCustomer, memo: e.target.value})}
                  className="w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[80px]"
                  placeholder="注意事項や好みなど..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowNewCustomerModal(false)}
                  className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 font-bold rounded-xl transition"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={!newCustomer.display_name.trim() || isCreating}
                  className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold rounded-xl transition flex justify-center items-center"
                >
                  {isCreating ? <Loader2 className="w-5 h-5 animate-spin" /> : '登録する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
