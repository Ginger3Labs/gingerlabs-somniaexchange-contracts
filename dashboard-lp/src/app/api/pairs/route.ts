import { NextRequest, NextResponse } from 'next/server';
import { clientPromise, dbName } from '@/lib/mongodb';
import { rateLimiter } from '@/lib/rate-limiter';

export async function GET(request: NextRequest) {
    try {
        // Optional: Add rate limiting if needed
        // const ip = request.ip ?? '127.0.0.1';
        // await rateLimiter.consume(ip);

        const client = await clientPromise;
        const db = client.db(dbName);

        // Get pre-calculated pairs from the 'pairs' collection
        const pairs = await db.collection('pairs').find({}).toArray();

        // The data is already enriched by our script, so we just return it.
        return NextResponse.json({
            success: true,
            data: pairs
        });
    } catch (error) {
        console.error('Failed to fetch pairs from cache:', error);
        return NextResponse.json(
            { error: 'Failed to fetch pairs from cache' },
            { status: 500 }
        );
    }
}