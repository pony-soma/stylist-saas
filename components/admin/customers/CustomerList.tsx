'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, Search, User, Phone, Calendar, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { CustomerInfo } from '@/types';
import MedicalRecordView from '../MedicalRecord';

export default function CustomerList() {
  const [userId, setUserId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  useEffect(() => {
    const fetchUserAndCustomers = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = '/login';
        return;
      }
      setUserId(session.user.id);
      
      // 担当している顧客（過去に予約があった顧客）を取得
      const { data: bookings } = await supabase
        .from('bookings')
        .select(`
          customer_id,
          customers (
            id,
            display_name,
            phone_number,
            line_picture_url,
            line_user_id,
            created_at
          )
        `)
        .eq('stylist_id', session.user.id)
        .order('created_at', { ascending: false });
      
      if (bookings) {
        // 重複を排除
        const uniqueCustomersMap = new Map<string, CustomerInfo>();
        bookings.forEach((b: any) => {
          if (b.customers && !uniqueCustomersMap.has(b.customers.id)) {
            uniqueCustomersMap.set(b.customers.id, b.customers);
          }
        });
        setCustomers(Array.from(uniqueCustomersMap.values()));
      }
      setLoading(false);
    };

    fetchUserAndCustomers();
  }, []);

  const filteredCustomers = customers.filter(c => 
    c.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone_number?.includes(searchTerm)
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex items-center gap-4 pb-4 border-b border-gray-200 dark:border-gray-800">
        <Link 
          href="/admin" 
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition shadow-sm"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">顧客一覧</h1>
          <p className="text-sm text-gray-500 mt-1">全 {customers.length} 名</p>
        </div>
      </header>

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
              onClick={() => setSelectedCustomerId(customer.id)}
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
                <h3 className="font-bold text-gray-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                  {customer.display_name}
                </h3>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                  {customer.phone_number ? (
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3"/> {customer.phone_number}</span>
                  ) : (
                    <span className="text-gray-400">電話番号未登録</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedCustomerId && userId && (
        <MedicalRecordView
          customerId={selectedCustomerId}
          onClose={() => setSelectedCustomerId(null)}
        />
      )}
    </div>
  );
}
