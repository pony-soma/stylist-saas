import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { isMaintenanceBlocked, maintenanceHeaders, maintenanceHtml } from '@/lib/maintenance'

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (isMaintenanceBlocked(path, process.env.LINO_MAINTENANCE_MODE)) {
    if (path === '/api' || path.startsWith('/api/')) {
      // Includes Stripe/LINE callbacks: return non-2xx so delivery is not lost.
      return NextResponse.json({ error: 'メンテナンス中です。時間をおいて再試行してください。' }, { status: 503, headers: maintenanceHeaders });
    }
    return new NextResponse(maintenanceHtml, { status: 503, headers: { ...maintenanceHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
  }
  // Keep the pre-existing session-refresh scope. Public pages and APIs retain
  // their own auth behavior when maintenance is disabled.
  if (path === '/admin' || path.startsWith('/admin/') || path === '/login' || path === '/billing') {
    return await updateSession(request);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
