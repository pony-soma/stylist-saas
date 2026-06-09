import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { MedicalRecord, CustomerInfo } from '@/types';

export function useMedicalRecords(customerId: string) {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    // 顧客情報の取得
    const { data: customerData } = await supabase
      .from('customers')
      .select('id, display_name, phone_number, created_at')
      .eq('id', customerId)
      .single();
      
    if (customerData) {
      setCustomerInfo(customerData);
    }

    // カルテ履歴の取得
    const { data: recordsData } = await supabase
      .from('medical_records')
      .select(`
        id, visit_date, treatment_menu, chemicals_used, notes,
        record_photos ( storage_path )
      `)
      .eq('customer_id', customerId)
      .order('visit_date', { ascending: false });

    if (recordsData) {
      setRecords(recordsData as MedicalRecord[]);
    }
    setLoading(false);
  }, [customerId]);

  const addRecord = async (stylistId: string, visit_date: string, treatment_menu: string, chemicals_used: string, notes: string) => {
    const { error } = await supabase
      .from('medical_records')
      .insert({
        customer_id: customerId,
        stylist_id: stylistId,
        visit_date,
        treatment_menu,
        chemicals_used,
        notes
      });
    if (error) throw error;
  };

  const updateRecord = async (recordId: string, visit_date: string, treatment_menu: string, chemicals_used: string, notes: string) => {
    const { error } = await supabase
      .from('medical_records')
      .update({
        visit_date,
        treatment_menu,
        chemicals_used,
        notes
      })
      .eq('id', recordId);
    if (error) throw error;
  };

  const deleteRecord = async (recordId: string) => {
    const { error } = await supabase
      .from('medical_records')
      .delete()
      .eq('id', recordId);
    if (error) throw error;
  };

  return {
    records,
    customerInfo,
    loading,
    fetchRecords,
    addRecord,
    updateRecord,
    deleteRecord
  };
}
