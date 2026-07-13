import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { CustomerInfo } from '@/types';

export function useCustomers(userId: string | null) {
  const [proxyCustomers, setProxyCustomers] = useState<{id: string, display_name: string}[]>([]);

  const fetchProxyCustomers = useCallback(async () => {
    if (!userId) return;
    // 担当している顧客のID一覧を取得（予約履歴 または メモが存在する顧客）
    const { data: bookings } = await supabase.from('bookings').select('customer_id').eq('stylist_id', userId);
    const { data: memos } = await supabase.from('customer_memos').select('customer_id').eq('stylist_id', userId);
    
    const customerIds = new Set<string>();
    bookings?.forEach(b => customerIds.add(b.customer_id));
    memos?.forEach(m => customerIds.add(m.customer_id));

    if (customerIds.size > 0) {
      const { data: customersData } = await supabase
        .from('customers')
        .select('id, display_name')
        .in('id', Array.from(customerIds))
        .order('created_at', { ascending: false });

      if (customersData) {
        setProxyCustomers(customersData);
        return customersData;
      }
    }
    setProxyCustomers([]);
    return [];
  }, [userId]);

  return {
    proxyCustomers,
    fetchProxyCustomers
  };
}
