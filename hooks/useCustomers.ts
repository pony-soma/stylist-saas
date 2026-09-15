import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';

export function useCustomers(userId: string | null) {
  const [proxyCustomers, setProxyCustomers] = useState<{id: string, display_name: string}[]>([]);

  const fetchProxyCustomers = useCallback(async () => {
    if (!userId) return;
    // 担当関係を基準に、予約前の新規顧客も選択できるようにする。
    const { data: relationships } = await supabase.from('stylist_customers').select('customer_id').eq('stylist_id', userId);
    const customerIds = new Set<string>(relationships?.map(r => r.customer_id) ?? []);

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
