import React from 'react';
import { X, Clock, Loader2 } from 'lucide-react';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date | null;
  timeSlots: { time: string, available: boolean }[];
  selectedTime: string | null;
  onSelectTime: (time: string) => void;
  onSubmit: () => void;
  submitting: boolean;
};

export default function TimeSlotSheet({
  isOpen, onClose, selectedDate, timeSlots, selectedTime, onSelectTime, onSubmit, submitting
}: Props) {
  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 z-40 max-w-md mx-auto ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      <div 
        className={`fixed bottom-0 w-full max-w-md mx-auto bg-white rounded-t-3xl shadow-2xl transition-transform duration-500 z-50 p-6 flex flex-col ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ maxHeight: '80vh' }}
      >
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6"></div>
        
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-900">
            {selectedDate ? `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日 (${['日', '月', '火', '水', '木', '金', '土'][selectedDate.getDay()]})` : ''}
          </h3>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 pr-2 space-y-3 pb-24">
          {timeSlots.map((slot, i) => (
            <button
              key={i}
              disabled={!slot.available}
              onClick={() => onSelectTime(slot.time)}
              className={`w-full py-4 px-5 rounded-2xl flex justify-between items-center transition-all active:scale-[0.98]
                ${!slot.available ? 'bg-gray-50 opacity-50 cursor-not-allowed' : 
                  selectedTime === slot.time 
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' 
                    : 'bg-white border border-gray-200 text-gray-700 hover:border-indigo-300'
                }
              `}
            >
              <span className="font-bold flex items-center gap-2 text-lg">
                <Clock className="w-5 h-5 opacity-70" /> {slot.time}
              </span>
              {slot.available ? (
                <span className={`text-sm font-medium ${selectedTime === slot.time ? 'text-indigo-100' : 'text-indigo-600'}`}>
                  選択
                </span>
              ) : (
                <span className="text-sm text-gray-400">× 満席</span>
              )}
            </button>
          ))}
        </div>

        <div className="absolute bottom-0 left-0 w-full p-5 bg-gradient-to-t from-white via-white to-transparent pt-10">
          <button 
            onClick={onSubmit}
            disabled={!selectedTime || submitting}
            className={`w-full py-4 rounded-2xl font-bold text-lg shadow-lg transition-all active:scale-[0.98] flex justify-center items-center gap-2
              ${selectedTime && !submitting
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200' 
                : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
              }
            `}
          >
            {submitting ? <><Loader2 className="w-5 h-5 animate-spin" /> 送信中...</> : '予約リクエストを送信'}
          </button>
        </div>
      </div>
    </>
  );
}
