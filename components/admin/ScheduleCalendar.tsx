'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, dateFnsLocalizer, Views, SlotInfo } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import 'react-big-calendar/lib/css/react-big-calendar.css';

import { useBookings } from '@/hooks/useBookings';
import { useAvailability } from '@/hooks/useAvailability';
import { supabase } from '@/lib/supabase/client';
import { Loader2, ArrowLeft, Calendar as CalendarIcon, Settings } from 'lucide-react';
import Link from 'next/link';
import EditBookingModal from './dashboard/EditBookingModal';
import { Menu } from '@/types';

const locales = {
  'ja': ja,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

type CalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: 'booking' | 'block';
  status?: string;
  customers?: any;
};

// --- Custom Toolbar Component ---
const CustomToolbar = (toolbar: any) => {
  const goToBack = () => toolbar.onNavigate('PREV');
  const goToNext = () => toolbar.onNavigate('NEXT');
  const goToCurrent = () => toolbar.onNavigate('TODAY');

  const label = () => {
    // ツールバーのラベル（「2026年 6月」など）
    const date = format(toolbar.date, toolbar.view === 'day' ? 'yyyy年 M月 d日 (E)' : 'yyyy年 M月', { locale: ja });
    return <span className="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2"><CalendarIcon className="w-5 h-5 text-indigo-500" /> {date}</span>;
  };

  return (
    <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
        <button className="whitespace-nowrap px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200" onClick={goToBack}>前へ</button>
        <button className="whitespace-nowrap px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200" onClick={goToCurrent}>今日</button>
        <button className="whitespace-nowrap px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200" onClick={goToNext}>次へ</button>
      </div>
      <div>
        {label()}
      </div>
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 w-full sm:w-auto overflow-x-auto">
        {toolbar.views.map((viewName: string) => (
          <button
            key={viewName}
            className={`whitespace-nowrap px-4 py-1.5 text-sm font-medium rounded-lg transition ${
              toolbar.view === viewName 
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-400 border border-slate-200 dark:border-slate-600' 
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 border border-transparent'
            }`}
            onClick={() => toolbar.onView(viewName)}
          >
            {viewName === 'month' ? '月' : viewName === 'week' ? '週' : '日'}
          </button>
        ))}
      </div>
    </div>
  );
};
// ---------------------------------

export default function ScheduleCalendar() {
  const [userId, setUserId] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const { monthBookings, loading: bookingsLoading, fetchBookings, updateBookingDetails, updateBookingStatus } = useBookings(userId);
  const { blockedSlots, loading: availabilityLoading, fetchAvailability, createBlockedSlot, deleteBlockedSlot } = useAvailability(userId);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [editingBooking, setEditingBooking] = useState<any | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (userId) {
      fetchBookings(currentDate);
      fetchAvailability();
    }
  }, [userId, currentDate, fetchBookings, fetchAvailability]);

  useEffect(() => {
    const newEvents: CalendarEvent[] = [];

    // Add bookings
    monthBookings.forEach(b => {
      if (b.status === 'cancelled') return;
      newEvents.push({
        id: b.id,
        title: b.customers?.display_name ? `${b.customers.display_name}様` : '予約',
        start: new Date(b.start_time),
        end: new Date(b.end_time),
        type: 'booking',
        status: b.status
      });
    });

    // Add blocked slots
    blockedSlots.forEach(block => {
      newEvents.push({
        id: block.id,
        title: block.title,
        start: new Date(block.start_time),
        end: new Date(block.end_time),
        type: 'block'
      });
    });

    setEvents(newEvents);
  }, [monthBookings, blockedSlots]);

  const handleSelectSlot = async (slotInfo: SlotInfo) => {
    const start = slotInfo.start;
    const end = slotInfo.end;
    
    // Default to a 1-hour block if clicked on month view
    if (start.getTime() === end.getTime() || slotInfo.action === 'click') {
      end.setHours(start.getHours() + 1);
    }

    const isOverlapping = events.some(e => {
      // 提案スロットが既存のイベントと重なるか: (StartA < EndB) && (EndA > StartB)
      return (start.getTime() < e.end.getTime()) && (end.getTime() > e.start.getTime());
    });

    if (isOverlapping) {
      alert('指定された時間はすでに他の予定（予約または不可枠）と重複しています。');
      return;
    }

    const confirmMsg = `${format(start, 'MM/dd HH:mm')} 〜 ${format(end, 'HH:mm')} を「予約不可」としてブロックしますか？`;
    if (confirm(confirmMsg)) {
      const title = prompt('予定のタイトルを入力（空欄なら「予約不可」）') || '予約不可';
      const success = await createBlockedSlot(title, start.toISOString(), end.toISOString());
      if (success) {
        fetchAvailability();
      } else {
        alert('ブロックの作成に失敗しました。');
      }
    }
  };

  const handleSelectEvent = async (event: CalendarEvent) => {
    if (event.type === 'block') {
      if (confirm(`「${event.title}」のブロック枠を削除しますか？`)) {
        const success = await deleteBlockedSlot(event.id);
        if (success) {
          fetchAvailability();
        } else {
          alert('削除に失敗しました。');
        }
      }
    } else {
      // It's a booking
      const booking = monthBookings.find(b => b.id === event.id);
      if (booking) {
        setEditingBooking(booking);
      }
    }
  };

  const eventStyleGetter = (event: CalendarEvent) => {
    let style: React.CSSProperties = {
      borderRadius: '6px',
      opacity: 0.95,
      color: 'white',
      border: '0px',
      display: 'block',
      padding: '2px 4px',
      fontSize: '12px',
      fontWeight: '500',
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
    };
    
    if (event.type === 'block') {
      style.background = 'linear-gradient(135deg, #64748b 0%, #475569 100%)'; // Slate for blocked
    } else if (event.status === 'pending') {
      style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'; // Amber for pending
    } else {
      style.background = 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'; // Indigo for confirmed
    }

    return { style };
  };

  if (!userId || (bookingsLoading && monthBookings.length === 0)) {
    return <div className="p-6 text-center text-gray-500 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />読み込み中...</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto animate-in fade-in duration-500">
      <div className="mb-6">
        <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 transition font-medium">
          <ArrowLeft className="w-4 h-4" />
          ダッシュボードに戻る
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">スケジュール</h1>
          <p className="text-sm text-slate-500 mt-1">空いている枠をクリック＆ドラッグして「予約不可」にできます。</p>
        </div>
        <Link 
          href="/admin/schedule/settings"
          className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 px-4 py-2.5 rounded-xl text-sm font-bold transition shadow-sm flex items-center gap-2 group"
        >
          <Settings className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition" />
          営業時間・定休日の設定
        </Link>
      </div>

      <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800/50" style={{ height: '700px' }}>
        <div className="h-full overflow-x-auto">
          <div className="h-full min-w-[768px]">
            <Calendar
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              style={{ height: '100%' }}
              views={[Views.MONTH, Views.WEEK, Views.DAY]}
              defaultView={Views.WEEK}
              onNavigate={(date) => setCurrentDate(date)}
              selectable={true}
              onSelectSlot={handleSelectSlot}
              onSelectEvent={handleSelectEvent}
              eventPropGetter={eventStyleGetter}
              components={{
                toolbar: CustomToolbar
              }}
              culture="ja"
              messages={{
                next: "次へ",
                previous: "前へ",
                today: "今日",
                month: "月",
                week: "週",
                day: "日",
                noEventsInRange: "この期間に予定はありません"
              }}
              min={new Date(2020, 0, 1, 8, 0, 0)} // Start week/day view at 8 AM
              max={new Date(2020, 0, 1, 23, 0, 0)} // End week/day view at 11 PM
            />
          </div>
        </div>
      </div>

      {/* 予約編集モーダル */}
      <EditBookingModal 
        isOpen={!!editingBooking} 
        onClose={() => setEditingBooking(null)}
        booking={editingBooking}
        onSave={async (id: string, start: string, end: string, menuNote: string, selectedMenus: Menu[], totalPrice: number) => {
          if (await updateBookingDetails(id, start, end, menuNote, selectedMenus, totalPrice)) {
            fetchBookings(currentDate);
          } else {
            throw new Error('Update failed');
          }
        }}
        onDelete={async (id: string) => {
          await updateBookingStatus(id, 'cancelled');
          fetchBookings(currentDate);
        }}
        userId={userId!}
      />
    </div>
  );
}
