import AdminDashboard from '@/components/admin/Dashboard';

export default function AdminPage({ searchParams }: { searchParams: { date?: string } }) {
  const date = searchParams.date;
  const initialDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T12:00:00Z`))
    && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date ? date : undefined;
  return (
    <div className="bg-gray-50 dark:bg-slate-950 min-h-screen pb-20 transition-colors duration-300">
      <AdminDashboard key={initialDate || 'today'} initialDate={initialDate} />
    </div>
  );
}
