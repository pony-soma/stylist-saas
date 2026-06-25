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

  const createMenu = async (name: string, duration: number, price: number) => {
    if (!stylistId) return false;
    const { error } = await supabase
      .from('menus')
      .insert({
        stylist_id: stylistId,
        name,
        duration,
        price
      });
    return !error;
  };

  const updateMenu = async (id: string, name: string, duration: number, price: number) => {
    if (!stylistId) return false;
    const { error } = await supabase
      .from('menus')
      .update({
        name,
        duration,
        price,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('stylist_id', stylistId);
    return !error;
  };

  const deleteMenu = async (id: string) => {
    if (!stylistId) return false;
    const { error } = await supabase
      .from('menus')
      .delete()
      .eq('id', id)
      .eq('stylist_id', stylistId);
    return !error;
  };

  return {
    menus,
    loading,
    fetchMenus,
    createMenu,
    updateMenu,
    deleteMenu
  };
}
