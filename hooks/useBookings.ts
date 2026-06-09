import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Booking } from '@/types';

export function useBookings(userId: string | null) {
  const [pending, setPending] = useState<Booking[]>([]);
  const [monthBookings, setMonthBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBookings = useCallback(async (targetMonth: Date) => {
    if (!userId) return;
    setLoading(true);

    // 1. 未承認の予約を取得
    const { data: pendingData } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, menu_note, status, customer_id, customers(display_name)')
      .eq('stylist_id', userId)
      .eq('status', 'pending')
      .order('start_time', { ascending: true });

    if (pendingData) setPending(pendingData as unknown as Booking[]);

    // 2. 指定月の予約を取得
    const firstDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
    const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59);
    
    const { data: monthData } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, menu_note, status, customer_id, customers(display_name)')
      .eq('stylist_id', userId)
      .gte('start_time', firstDay.toISOString())
      .lte('start_time', lastDay.toISOString())
      .order('start_time', { ascending: true });

    if (monthData) setMonthBookings(monthData as unknown as Booking[]);
    setLoading(false);
  }, [userId]);

  const updateBookingStatus = async (id: string, status: 'confirmed' | 'cancelled') => {
    const { error } = await supabase
      .from('bookings')
      .update({ status })
      .eq('id', id);
    return !error;
  };

  const createProxyBooking = async (customerId: string, date: string, startTime: string, endTime: string, menu: string) => {
    if (!userId) throw new Error('User not authenticated');
    const startDateTime = new Date(`${date}T${startTime}:00`);
    const endDateTime = new Date(`${date}T${endTime}:00`);
    
    const { error } = await supabase
      .from('bookings')
      .insert({
        customer_id: customerId,
        stylist_id: userId,
        start_time: startDateTime.toISOString(),
        end_time: endDateTime.toISOString(),
        menu_note: menu,
        status: 'confirmed'
      });
      
    if (error) throw error;
  };

  return {
    pending,
    monthBookings,
    loading,
    fetchBookings,
    updateBookingStatus,
    createProxyBooking
  };
}
