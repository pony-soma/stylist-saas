import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { CustomerInfo } from '@/types';

export function useCustomers(userId: string | null) {
  const [proxyCustomers, setProxyCustomers] = useState<{id: string, display_name: string}[]>([]);

  const fetchProxyCustomers = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('bookings')
      .select('customer_id, customers(id, display_name)')
      .eq('stylist_id', userId)
      .order('created_at', { ascending: false });
    
    if (data) {
      const unique = Array.from(new Map(data.map((item: any) => [item.customer_id, item.customers])).values()).filter(Boolean) as unknown as {id: string, display_name: string}[];
      setProxyCustomers(unique);
      return unique;
    }
    return [];
  }, [userId]);

  return {
    proxyCustomers,
    fetchProxyCustomers
  };
}
