import { NextResponse } from 'next/server';
import { encrypt } from '@/lib/session';

export async function POST(request: Request) {
    try {
        const { username, password } = await request.json();

        const appUsername = process.env.APP_USERNAME;
        const appPassword = process.env.APP_PASSWORD;

        if (!appUsername || !appPassword) {
            console.error('Authentication variables are not set in .env file');
            return NextResponse.json(
                { success: false, message: 'Server configuration error.' },
                { status: 500 }
            );
        }

        if (username === appUsername && password === appPassword) {
            // 1. Create the session payload
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day
            const session = await encrypt({ username, expiresAt });

            // 2. Create the response and set the cookie
            const response = NextResponse.json({ success: true });
            response.cookies.set('session', session, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                expires: expiresAt,
                sameSite: 'lax',
                path: '/',
            });
            return response;
        } else {
            return NextResponse.json(
                { success: false, message: 'Invalid username or password' },
                { status: 401 }
            );
        }
    } catch (error) {
        console.error('Login API error:', error);
        return NextResponse.json(
            { success: false, message: 'An internal server error occurred.' },
            { status: 500 }
        );
    }
}