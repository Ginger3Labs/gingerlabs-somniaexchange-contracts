import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    // Get the cookie from the request
    const isLoggedIn = request.cookies.get('isLoggedIn')?.value;

    const { pathname } = request.nextUrl;

    // If the user is trying to access the login page but is already logged in,
    // redirect them to the dashboard.
    if (isLoggedIn && pathname === '/login') {
        return NextResponse.redirect(new URL('/', request.url));
    }

    // If the user is trying to access the dashboard but is not logged in,
    // redirect them to the login page.
    if (!isLoggedIn && pathname === '/') {
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