import AdminDashboard from '@/components/admin/Dashboard';
import MedicalRecordView from '@/components/admin/MedicalRecord';

export default function AdminPage() {
  return (
    <div className="bg-gray-50 min-h-screen pb-20">
      <AdminDashboard />
      <div className="my-10" />
      <MedicalRecordView />
    </div>
  );
}
