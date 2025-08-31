import { NextResponse } from 'next/server';

export async function POST() {
    try {
        // Create a response and delete the session cookie
        const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
        response.cookies.set('session', '', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            expires: new Date(0), // Expire the cookie immediately
            path: '/',
        });
        return response;
    } catch (error) {
        console.error('Logout API error:', error);
        return NextResponse.json(
            { success: false, message: 'An internal server error occurred.' },
            { status: 500 }
        );
    }
}