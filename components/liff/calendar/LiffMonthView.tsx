import React from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

type DayData = {
  date: Date;
  isAvailable: boolean;
};

type Props = {
  currentMonth: Date;
  days: DayData[];
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onDateClick: (day: DayData) => void;
};

export default function LiffMonthView({ currentMonth, days, onPrevMonth, onNextMonth, onDateClick }: Props) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-sm border border-gray-100 dark:border-gray-800 transition-colors">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onPrevMonth} className="w-8 h-8 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center text-gray-600 dark:text-gray-400 active:scale-95 transition-transform hover:bg-gray-100 dark:hover:bg-slate-700">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-indigo-500" />
          {currentMonth.getFullYear()}年 {currentMonth.getMonth() + 1}月
        </h2>
        <button onClick={onNextMonth} className="w-8 h-8 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center text-gray-600 dark:text-gray-400 active:scale-95 transition-transform hover:bg-gray-100 dark:hover:bg-slate-700">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-2 mb-2">
        {['日', '月', '火', '水', '木', '金', '土'].map(day => (
          <div key={day} className="text-center text-xs font-semibold text-gray-400 dark:text-slate-500 py-1">
            {day}
          </div>
        ))}
      </div>
      
      <div className="grid grid-cols-7 gap-2">
        {days.length > 0 && Array.from({ length: days[0].date.getDay() }).map((_, i) => (
          <div key={`empty-${i}`} className="h-10"></div>
        ))}
        
        {days.map((day, i) => (
          <button
            key={i}
            onClick={() => onDateClick(day)}
            disabled={!day.isAvailable}
            className={`h-10 w-full rounded-full flex items-center justify-center text-sm font-medium transition-all duration-200 active:scale-90
              ${day.isAvailable 
                ? 'text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 hover:text-indigo-600 dark:hover:text-indigo-400 border border-transparent' 
                : 'text-gray-300 dark:text-slate-700 opacity-50 cursor-not-allowed'
              }
            `}
          >
            {day.date.getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}
