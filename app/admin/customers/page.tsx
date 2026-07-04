import CustomerList from '@/components/admin/customers/CustomerList';

export default function CustomersPage() {
  return (
    <div className="bg-gray-50 dark:bg-slate-950 min-h-screen pb-20 transition-colors duration-300">
      <CustomerList />
    </div>
  );
}
