import { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { SubscriptionBanner } from '@/components/admin/SubscriptionBanner';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Suspense fallback={null}>
        <SubscriptionBanner userId={session.user.id} userEmail={session.user.email} />
      </Suspense>
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
}
