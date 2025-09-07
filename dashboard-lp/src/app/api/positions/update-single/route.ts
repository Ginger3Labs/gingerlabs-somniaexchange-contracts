import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { ethers, Contract, getAddress, formatUnits } from 'ethers';
import { clientPromise } from '@/lib/mongodb';
import IUniswapV2Pair from '@/abis/SomniaExchangePair.json';
import IUniswapV2ERC20 from '@uniswap/v2-core/build/IUniswapV2ERC20.json';
import IUniswapV2Factory from '@/abis/SomniaExchangeFactory.json';
import RouterABI from '@/abis/SomniaExchangeRouter.json';

// --- Configuration ---
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;
const TARGET_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TARGET_TOKEN_ADDRESS;
const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const WRAPPED_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_WRAPPED_TOKEN_ADDRESS;
const POSITIONS_COLLECTION = 'positions';

if (!MONGODB_DB_NAME || !RPC_URL || !TARGET_TOKEN_ADDRESS || !FACTORY_ADDRESS || !ROUTER_ADDRESS || !WRAPPED_TOKEN_ADDRESS) {
    throw new Error('One or more environment variables are not set for single position update.');
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const factoryContract = new Contract(FACTORY_ADDRESS!, IUniswapV2Factory.abi, provider);
const routerContract = new Contract(ROUTER_ADDRESS!, RouterABI.abi, provider);

// --- Helper Functions (Copied from calculatePositions script) ---

const tokenDataCache = new Map<string, { symbol: string; name: string; decimals: number }>();
async function getTokenData(tokenAddress: string) {
    const address = getAddress(tokenAddress);
    if (tokenDataCache.has(address)) {
        return tokenDataCache.get(address)!;
    }
    try {
        const tokenContract = new Contract(address, IUniswapV2ERC20.abi, provider);
        const [symbol, name, decimals] = await Promise.all([
            tokenContract.symbol(),
            tokenContract.name(),
            tokenContract.decimals(),
        ]);
        const data = { symbol, name, decimals: Number(decimals) };
        tokenDataCache.set(address, data);
        return data;
    } catch (error) {
        console.error(`Error fetching data for token ${address}:`, error);
        return { symbol: 'ERR', name: 'Error', decimals: 18 };
    }
}

const PRICE_PRECISION = 18;
const normalizeAddress = (address: string) => getAddress(address);

async function getBestAmountOut(tokenInAddress: string, tokenOutAddress: string, amountIn: bigint): Promise<{ amount: bigint, path: string[] }> {
    const tIn = normalizeAddress(tokenInAddress);
    const tOut = normalizeAddress(tokenOutAddress);
    if (tIn === tOut) return { amount: amountIn, path: [tokenInAddress] };

    const ZERO_ADDRESS = ethers.ZeroAddress;
    try {
        const path = [tIn, tOut];
        const amountsOut = await routerContract.getAmountsOut(amountIn, path);
        if (amountsOut[1] > 0n) return { amount: amountsOut[1], path };
    } catch { }

    try {
        const path = [tIn, WRAPPED_TOKEN_ADDRESS!, tOut];
        const amountsOut = await routerContract.getAmountsOut(amountIn, path);
        if (amountsOut[2] > 0n) return { amount: amountsOut[2], path };
    } catch { }

    return { amount: 0n, path: [] };
}

async function getPriceInTargetToken(tokenInAddress: string): Promise<bigint> {
    const tokenIn = getAddress(tokenInAddress);
    const targetToken = getAddress(TARGET_TOKEN_ADDRESS!);
    if (tokenIn === targetToken) return 10n ** BigInt(PRICE_PRECISION);

    const tokenInData = await getTokenData(tokenIn);
    const targetTokenData = await getTokenData(targetToken);
    const amountIn = 10n ** BigInt(tokenInData.decimals);

    const { amount: bestAmountOut } = await getBestAmountOut(tokenIn, targetToken, amountIn);
    if (bestAmountOut === 0n) return 0n;

    return (bestAmountOut * (10n ** BigInt(PRICE_PRECISION))) / (10n ** BigInt(targetTokenData.decimals));
}


export async function POST(request: NextRequest) {
    try {
        const { pairAddress, walletAddress } = await request.json();

        if (!pairAddress || !walletAddress || !ethers.isAddress(pairAddress) || !ethers.isAddress(walletAddress)) {
            return NextResponse.json({ success: false, message: 'Valid pairAddress and walletAddress are required.' }, { status: 400 });
        }

        const client = await clientPromise;
        const db = client.db(MONGODB_DB_NAME);
        const positionsCollection = db.collection(POSITIONS_COLLECTION);

        const pairContract = new Contract(pairAddress, IUniswapV2Pair.abi, provider);
        const balance = await pairContract.balanceOf(walletAddress);

        if (balance === 0n) {
            const deleteResult = await positionsCollection.deleteOne({
                walletAddress: getAddress(walletAddress),
                pairAddress: getAddress(pairAddress)
            });
            console.log(`Position for ${walletAddress} in ${pairAddress} is zero. Deleted: ${deleteResult.deletedCount}`);
            return NextResponse.json({ success: true, message: 'Position is zero and has been removed.' });
        }

        // If balance exists, update the position data
        const [reserves, totalSupply, token0Address, token1Address] = await Promise.all([
            pairContract.getReserves(),
            pairContract.totalSupply(),
            pairContract.token0(),
            pairContract.token1(),
        ]);

        const [token0Data, token1Data] = await Promise.all([
            getTokenData(token0Address),
            getTokenData(token1Address),
        ]);

        const reserve0_bigint = BigInt(reserves[0].toString());
        const reserve1_bigint = BigInt(reserves[1].toString());

        const userAmount0_bigint = (balance * reserve0_bigint) / totalSupply;
        const userAmount1_bigint = (balance * reserve1_bigint) / totalSupply;

        const [price0, price1] = await Promise.all([
            getPriceInTargetToken(token0Address),
            getPriceInTargetToken(token1Address)
        ]);

        const value0InTarget = (userAmount0_bigint * price0) / (10n ** BigInt(token0Data.decimals));
        const value1InTarget = (userAmount1_bigint * price1) / (10n ** BigInt(token1Data.decimals));
        const totalValueInTarget = value0InTarget + value1InTarget;

        const userShare = Number(balance) / Number(totalSupply);

        const updatedPosition = {
            walletAddress: getAddress(walletAddress),
            pairAddress: getAddress(pairAddress),
            lpBalance: balance.toString(),
            poolShare: userShare.toString(),
            totalValueUSD: formatUnits(totalValueInTarget, PRICE_PRECISION),
            token0: { address: getAddress(token0Address), symbol: token0Data.symbol, route: [] },
            token1: { address: getAddress(token1Address), symbol: token1Data.symbol, route: [] },
            estimatedWithdraw: {
                token0Amount: formatUnits(userAmount0_bigint, token0Data.decimals),
                token1Amount: formatUnits(userAmount1_bigint, token1Data.decimals),
                token0ValueInTarget: formatUnits(value0InTarget, PRICE_PRECISION),
                token1ValueInTarget: formatUnits(value1InTarget, PRICE_PRECISION),
                totalValueInTarget: formatUnits(totalValueInTarget, PRICE_PRECISION),
            },
            updatedAt: new Date(),
        };

        await positionsCollection.updateOne(
            { walletAddress: getAddress(walletAddress), pairAddress: getAddress(pairAddress) },
            { $set: updatedPosition },
            { upsert: true }
        );

        console.log(`Successfully updated position for ${walletAddress} in ${pairAddress}.`);
        return NextResponse.json({ success: true, position: updatedPosition });

    } catch (error) {
        console.error('Error updating single position:', error);
        return NextResponse.json({ success: false, message: 'An internal server error occurred.' }, { status: 500 });
    }
}