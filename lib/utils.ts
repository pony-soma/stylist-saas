export const formatTime = (dateStr: string) => 
  new Date(dateStr).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

export const formatDate = (dateStr: string) => 
  new Date(dateStr).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });

export const getDurationMinutes = (start: string, end: string) => 
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);

// Calendar dates follow the displayed local day, not the UTC day of an instant.
export const formatLocalDateInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
