export const formatTime = (dateStr: string) => 
  new Date(dateStr).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

export const formatDate = (dateStr: string) => 
  new Date(dateStr).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });

export const getDurationMinutes = (start: string, end: string) => 
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
