import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Menu } from '@/types';

export function useMenus(stylistId: string | null) {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMenus = useCallback(async () => {
    if (!stylistId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('menus')
      .select('*')
      .eq('stylist_id', stylistId)
      .order('created_at', { ascending: true });
    
    if (data) {
      setMenus(data as Menu[]);
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
  const createMenu = (name: string, duration: number, price: number) =>
    mutate({ action: 'menu.create', name, duration, price });
  const updateMenu = (id: string, name: string, duration: number, price: number) =>
    mutate({ action: 'menu.update', id, name, duration, price });
  const deleteMenu = (id: string) => mutate({ action: 'menu.delete', id });

  return {
    menus,
    loading,
    fetchMenus,
    createMenu,
    updateMenu,
    deleteMenu
  };
}
