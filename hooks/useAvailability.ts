import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';

export type AvailabilitySetting = {
  id: string;
  stylist_id: string;
  day_of_week: number | null;
  specific_date: string | null;
  start_time: string | null;
  end_time: string | null;
  is_day_off: boolean;
};

export type BlockedTimeSlot = {
  id: string;
  stylist_id: string;
  title: string;
  start_time: string;
  end_time: string;
};

export function useAvailability(stylistId: string | null) {
  const [settings, setSettings] = useState<AvailabilitySetting[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedTimeSlot[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAvailability = useCallback(async () => {
    if (!stylistId) return;
    setLoading(true);
    
    // Fetch regular and specific availability settings
    const { data: settingsData } = await supabase
      .from('availability_settings')
      .select('*')
      .eq('stylist_id', stylistId);
      
    if (settingsData) {
      setSettings(settingsData as AvailabilitySetting[]);
    }

    // Fetch blocked time slots
    const { data: blockedData } = await supabase
      .from('blocked_time_slots')
      .select('*')
      .eq('stylist_id', stylistId);

    if (blockedData) {
      setBlockedSlots(blockedData as BlockedTimeSlot[]);
    }
    
    setLoading(false);
  }, [stylistId]);

  const upsertSetting = async (setting: Partial<AvailabilitySetting>) => {
    if (!stylistId) return false;
    const { error } = await supabase
      .from('availability_settings')
      .upsert({ ...setting, stylist_id: stylistId });
    return !error;
  };

  const deleteSetting = async (id: string) => {
    if (!stylistId) return false;
    const { error } = await supabase
      .from('availability_settings')
      .delete()
      .eq('id', id);
    return !error;
  };

  const createBlockedSlot = async (title: string, startTime: string, endTime: string) => {
    if (!stylistId) return false;
    const { error } = await supabase
      .from('blocked_time_slots')
      .insert({ stylist_id: stylistId, title, start_time: startTime, end_time: endTime });
    return !error;
  };

  const deleteBlockedSlot = async (id: string) => {
    if (!stylistId) return false;
    const { error } = await supabase
      .from('blocked_time_slots')
      .delete()
      .eq('id', id);
    return !error;
  };

  return {
    settings,
    blockedSlots,
    loading,
    fetchAvailability,
    upsertSetting,
    deleteSetting,
    createBlockedSlot,
    deleteBlockedSlot
  };
}
