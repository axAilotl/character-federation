import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getMaintenanceMode } from './lib/maintenance';
import { getSession } from './lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip maintenance check for:
  // - Admin routes (admins can always access)
  // - API routes (except non-admin API calls)
  // - Static files
  // - Maintenance page itself
  if (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icon') ||
    pathname === '/maintenance'
  ) {
    return NextResponse.next();
  }

  // Check maintenance mode
  const maintenance = await getMaintenanceMode();

  if (maintenance.enabled) {
    // Allow API access for admins only
    const session = await getSession();

    if (!session?.user.isAdmin) {
      // Redirect to maintenance page
      if (pathname !== '/maintenance') {
        return NextResponse.redirect(new URL('/maintenance', request.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
