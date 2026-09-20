import { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { SubscriptionBanner } from '@/components/admin/SubscriptionBanner';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getBillingStatus } from '@/lib/billing';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }

  const billing = await getBillingStatus(user.id);
  if (billing.status === 'pending') redirect('/billing');

  return (
    <div className="flex flex-col min-h-screen">
      <Suspense fallback={null}>
        <SubscriptionBanner />
      </Suspense>
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
}
