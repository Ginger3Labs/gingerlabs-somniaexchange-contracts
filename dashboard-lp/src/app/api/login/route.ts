import { NextResponse } from 'next/server';
import { createSession } from '@/lib/session';

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
            // Create the session
            await createSession(username);
            return NextResponse.json({ success: true });
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