import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/lib/session';

// This function can be marked `async` if using `await` inside
export async function middleware(request: NextRequest) {
    const sessionCookie = request.cookies.get('session')?.value;
    const session = await decrypt(sessionCookie);

    const { pathname } = request.nextUrl;

    // If the user is trying to access the login page but has a valid session,
    // redirect them to the dashboard.
    if (session && pathname === '/login') {
        return NextResponse.redirect(new URL('/', request.url));
    }

    // If the user is trying to access the dashboard but does not have a valid session,
    // redirect them to the login page.
    if (!session && pathname === '/') {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // Allow the request to proceed
    return NextResponse.next();
}

// See "Matching Paths" below to learn more
export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};