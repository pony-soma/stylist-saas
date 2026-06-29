'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, dateFnsLocalizer, Views, SlotInfo } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import 'react-big-calendar/lib/css/react-big-calendar.css';

import { useBookings } from '@/hooks/useBookings';
import { useAvailability } from '@/hooks/useAvailability';
import { supabase } from '@/lib/supabase/client';
import { Loader2, Plus } from 'lucide-react';
import Link from 'next/link';

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
};

export default function ScheduleCalendar() {
  const [userId, setUserId] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const { monthBookings, loading: bookingsLoading, fetchBookings } = useBookings(userId);
  const { blockedSlots, loading: availabilityLoading, fetchAvailability, createBlockedSlot, deleteBlockedSlot } = useAvailability(userId);

  const [events, setEvents] = useState<CalendarEvent[]>([]);

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
      alert(`${event.title} の予約です。（詳細編集機能は別画面で行います）`);
    }
  };

  const eventStyleGetter = (event: CalendarEvent) => {
    let backgroundColor = '#4f46e5'; // Indigo for confirmed bookings
    
    if (event.type === 'block') {
      backgroundColor = '#64748b'; // Slate for blocked slots
    } else if (event.status === 'pending') {
      backgroundColor = '#f59e0b'; // Amber for pending
    }

    return {
      style: {
        backgroundColor,
        borderRadius: '4px',
        opacity: 0.9,
        color: 'white',
        border: '0px',
        display: 'block'
      }
    };
  };

  if (!userId || (bookingsLoading && monthBookings.length === 0)) {
    return <div className="p-6 text-center text-gray-500 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />読み込み中...</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto animate-in fade-in duration-500">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">スケジュール</h1>
          <p className="text-sm text-gray-500 mt-1">空いている枠をクリック＆ドラッグして「予約不可」にできます。</p>
        </div>
        <Link 
          href="/admin/schedule/settings"
          className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 dark:bg-slate-800 dark:border-slate-700 dark:text-gray-200 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm"
        >
          営業時間・定休日の設定
        </Link>
      </div>

      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800" style={{ height: '700px' }}>
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
  );
}
