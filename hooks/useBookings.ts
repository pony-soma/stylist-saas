import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Booking, Menu } from '@/types';

export function useBookings(userId: string | null) {
  const [pending, setPending] = useState<Booking[]>([]);
  const [monthBookings, setMonthBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const pendingCreate = useRef<{ payload: string; requestId: string } | null>(null);

  const fetchBookings = useCallback(async (targetMonth: Date) => {
    if (!userId) return;
    setLoading(true);

    // 1. 未承認の予約を取得
    const { data: pendingData } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, menu_note, status, source, selected_menus, total_price, customer_id, customers(display_name)')
      .eq('stylist_id', userId)
      .eq('status', 'pending')
      .order('start_time', { ascending: true });

    if (pendingData) setPending(pendingData as unknown as Booking[]);

    // 2. 指定月の予約を取得
    const firstDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
    const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59);
    
    const { data: monthData } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, menu_note, status, source, selected_menus, total_price, customer_id, customers(display_name)')
      .eq('stylist_id', userId)
      .gte('start_time', firstDay.toISOString())
      .lte('start_time', lastDay.toISOString())
      .order('start_time', { ascending: true });

    if (monthData) setMonthBookings(monthData as unknown as Booking[]);
    setLoading(false);
  }, [userId]);

  const updateBookingStatus = async (id: string, status: 'confirmed' | 'cancelled') => {
    if (!userId) return false;
    try {
      const response = await fetch('/api/bookings/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: id, status }),
      });
      return response.ok;
    } catch { return false; }
  };

  const updateBookingDetails = async (
    id: string, startTime: string, endTime: string, menuNote: string,
    selectedMenus: Menu[] = [], _totalPrice: number = 0, expectedUpdatedAt?: string
  ) => {
    if (!userId || !expectedUpdatedAt) return false;
    try {
      const response = await fetch('/api/bookings/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: id, startTime, endTime, menuNote,
          menuIds: selectedMenus.map(menu => menu.id), expectedUpdatedAt }),
      });
      return response.ok;
    } catch { return false; }
  };

  const createProxyBooking = async (
    customerId: string, date: string, startTime: string, endTime: string, menu: string,
    selectedMenus: Menu[] = [], _totalPrice: number = 0
  ) => {
    if (!userId) throw new Error('User not authenticated');
    const details = { customerId, startTime: new Date(`${date}T${startTime}:00+09:00`).toISOString(),
      endTime: new Date(`${date}T${endTime}:00+09:00`).toISOString(), menuNote: menu,
      menuIds: selectedMenus.map(item => item.id).sort() };
    const payload = JSON.stringify({ userId, ...details });
    if (pendingCreate.current?.payload !== payload) {
      pendingCreate.current = { payload, requestId: crypto.randomUUID() };
    }
    // Keep the same key after a lost response; the server replays the original result.
    const response = await fetch('/api/bookings/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...details, requestId: pendingCreate.current.requestId }),
    });
    if (!response.ok) throw new Error('予約を保存できませんでした。利用期限・営業時間・予約不可枠を確認してください。');
    pendingCreate.current = null;
  };

  return {
    pending,
    monthBookings,
    loading,
    fetchBookings,
    updateBookingStatus,
    updateBookingDetails,
    createProxyBooking
  };
}
