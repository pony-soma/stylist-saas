import React from 'react';
import { Clock, User, Calendar as CalendarIcon, CheckCircle2, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Booking } from '@/types';
import { formatTime, formatDate } from '@/lib/utils';

type Props = {
  pending: Booking[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
};

export default function PendingBookingsList({ pending, onApprove, onReject }: Props) {
  const router = useRouter();
  if (pending.length === 0) return null;

  return (
    <section className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4 text-amber-800 dark:text-amber-500 font-semibold">
        <Clock className="w-5 h-5 animate-pulse" />
        <h2>未承認の仮予約が {pending.length} 件あります</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {pending.map((booking) => (
          <div key={booking.id} onClick={() => router.push(`/admin/customers/${booking.customer_id}`)} className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:shadow-md transition">
            <div>
              <p className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <User className="w-4 h-4 text-gray-400" />
                {booking.customers?.display_name || '名称未設定'}
              </p>
              <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                <CalendarIcon className="w-4 h-4" />
                {formatDate(booking.start_time)} {formatTime(booking.start_time)} - {formatTime(booking.end_time)}
              </p>
              <div className="flex gap-2 text-xs text-gray-500 mt-2 flex-wrap">
                {booking.selected_menus && booking.selected_menus.length > 0 ? (
                  booking.selected_menus.map(menu => (
                    <span key={menu.id} className="bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-full font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
                      {menu.name}
                    </span>
                  ))
                ) : null}
                {booking.menu_note && (
                  <span className="flex items-center gap-1">
                    <span className="w-1 h-1 bg-gray-400 rounded-full mx-1"></span>
                    {booking.menu_note}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <button onClick={(e) => { e.stopPropagation(); onReject(booking.id); }} className="flex-1 sm:flex-none px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium flex items-center justify-center gap-1"><XCircle className="w-4 h-4" /> 拒否</button>
              <button onClick={(e) => { e.stopPropagation(); onApprove(booking.id); }} className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1 shadow-sm"><CheckCircle2 className="w-4 h-4" /> 承認</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
