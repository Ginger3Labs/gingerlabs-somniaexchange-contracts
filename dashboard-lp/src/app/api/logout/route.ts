import { NextResponse } from 'next/server';
import { deleteSession } from '@/lib/session';

export async function POST() {
    try {
        deleteSession(); // This function handles cookie deletion
        return NextResponse.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout API error:', error);
        return NextResponse.json(
            { success: false, message: 'An internal server error occurred.' },
            { status: 500 }
        );
    }
}