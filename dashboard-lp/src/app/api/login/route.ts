import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

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
          // Create a response and set the cookie on it
          const response = NextResponse.json({ success: true });
          response.cookies.set('isLoggedIn', 'true', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24, // 1 day
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