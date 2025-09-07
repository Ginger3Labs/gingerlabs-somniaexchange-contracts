import { NextRequest, NextResponse } from 'next/server';
import { clientPromise, dbName } from '@/lib/mongodb';
import { ethers, getAddress } from 'ethers';

export async function GET(
    request: NextRequest,
    { params }: { params: { walletAddress: string } }
) {
    const url = new URL(request.url);
    const walletAddress = url.pathname.split('/').pop()!;

    if (!ethers.isAddress(walletAddress)) {
        return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    try {
        const client = await clientPromise;
        const db = client.db(dbName);

        // Fetch pre-calculated positions from the 'positions' collection
        const positions = await db.collection('positions')
            .find({ walletAddress: getAddress(walletAddress) }) // Use checksum address for matching
            .sort({ totalValueUSD: -1 }) // Sort by value descending
            .toArray();

        // If no positions are found, return a clean empty state
        if (!positions || positions.length === 0) {
            return NextResponse.json({
                success: true,
                data: [],
                totalValue: 0,
                timestamp: Date.now()
            });
        }

        // Remove MongoDB's _id and walletAddress from the response for a cleaner output
        const cleanedPositions = positions.map(({ _id, walletAddress, ...rest }) => rest);

        const totalValue = cleanedPositions.reduce((sum, pos) => sum + parseFloat(pos.totalValueUSD), 0);

        return NextResponse.json({
            success: true,
            data: cleanedPositions,
            totalValue: totalValue,
            timestamp: positions[0]?.lastUpdatedAt || Date.now() // Use timestamp from DB record
        });

    } catch (error) {
        console.error(`Failed to fetch cached positions for ${walletAddress}:`, error);
        return NextResponse.json(
            { error: 'Failed to fetch cached positions' },
            { status: 500 }
        );
    }
}