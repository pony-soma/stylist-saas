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

  const mutate = async (body: Record<string, unknown>) => {
    if (!stylistId) return false;
    try {
      const response = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response.ok;
    } catch { return false; }
  };
  const saveSettings = (entries: Partial<AvailabilitySetting>[]) => mutate({
    action: 'availability.save',
    settings: entries.map(s => ({
      ...(s.id ? { id: s.id } : {}),
      day_of_week: s.day_of_week ?? null, specific_date: s.specific_date ?? null,
      is_day_off: s.is_day_off ?? false,
      start_time: s.is_day_off ? null : s.start_time ?? null,
      end_time: s.is_day_off ? null : s.end_time ?? null,
    })),
  });
  const upsertSetting = (setting: Partial<AvailabilitySetting>) => saveSettings([setting]);
  const deleteSetting = (id: string) => mutate({ action: 'availability.delete', id });
  const createBlockedSlot = (title: string, startTime: string, endTime: string) =>
    mutate({ action: 'blocked.create', title, start_time: startTime, end_time: endTime });
  const deleteBlockedSlot = (id: string) => mutate({ action: 'blocked.delete', id });

  return {
    settings,
    blockedSlots,
    loading,
    fetchAvailability,
    upsertSetting,
    saveSettings,
    deleteSetting,
    createBlockedSlot,
    deleteBlockedSlot
  };
}
