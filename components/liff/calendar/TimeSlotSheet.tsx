import React, { useEffect, useRef } from 'react';
import { X, Clock, Loader2 } from 'lucide-react';

type Props = {
  isOpen: boolean;
  loading: boolean;
  error: string;
  onClose: () => void;
  selectedDate: Date | null;
  timeSlots: { time: string, available: boolean }[];
  selectedTime: string | null;
  onSelectTime: (time: string) => void;
  children?: React.ReactNode;
};

export default function TimeSlotSheet({
  isOpen, loading, error, onClose, selectedDate, timeSlots, selectedTime, onSelectTime, children
}: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, a[href], input:not(:disabled)');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [isOpen]);
  if (!isOpen) return null;
  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 z-40 max-w-md mx-auto ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      <div 
        ref={dialog} role="dialog" aria-modal="true" aria-label="予約時間を選択"
        className={`fixed bottom-0 w-full max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl transition-transform duration-150 z-50 p-6 flex flex-col ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ maxHeight: '80vh' }}
      >
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6"></div>
        
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">
            {selectedDate ? `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日 (${['日', '月', '火', '水', '木', '金', '土'][selectedDate.getDay()]})` : ''}
          </h3>
          <button 
            aria-label="時間選択を閉じる" onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-gray-500 dark:text-slate-300 active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 pr-2 pb-4">
          {loading && <p role="status" className="mb-4 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />空き時間を確認しています…</p>}
          {!loading && !error && timeSlots.length === 0 && <p role="status" className="mb-4 text-sm">この日に選択できる時間はありません。</p>}
          <div className="grid grid-cols-3 gap-3" aria-busy={loading}>
            {timeSlots.map((slot, i) => (
              <button
                key={i}
                disabled={!slot.available}
                onClick={() => onSelectTime(slot.time)}
                className={`py-3 px-2 rounded-xl flex flex-col items-center justify-center transition-all active:scale-[0.95]
                  ${!slot.available ? 'bg-gray-50 dark:bg-slate-800 opacity-50 cursor-not-allowed' : 
                    selectedTime === slot.time 
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 border border-indigo-600' 
                      : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:border-indigo-300'
                  }
                `}
              >
                <span className="font-bold flex items-center justify-center gap-1 text-base">
                  <Clock className={`w-4 h-4 ${selectedTime === slot.time ? 'opacity-80' : 'opacity-60'}`} /> 
                  {slot.time}
                </span>
                {slot.available ? (
                  <span className={`text-xs mt-1 font-medium ${selectedTime === slot.time ? 'text-indigo-100' : 'text-indigo-600'}`}>
                    {selectedTime === slot.time ? '選択中' : '選択できます'}
                  </span>
                ) : (
                  <span className="text-xs mt-1 text-gray-400">受付不可</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {children}
      </div>
    </>
  );
}
