import { MongoClient, AnyBulkWriteOperation } from 'mongodb';
import { ethers, Contract, formatUnits, getAddress } from 'ethers';
import { LpPosition } from '../src/types/lp';
import dotenv from 'dotenv';
import IUniswapV2Factory from '../src/abis/SomniaExchangeFactory.json';
import RouterABI from '../src/abis/SomniaExchangeRouter.json';
import IUniswapV2Pair from '../src/abis/SomniaExchangePair.json';
import IUniswapV2ERC20 from '@uniswap/v2-core/build/IUniswapV2ERC20.json';

dotenv.config({ path: '.env' });

// Define a type for the database document that includes walletAddress and updatedAt
interface DbLpPosition extends LpPosition {
    walletAddress: string;
    updatedAt: Date;
}

// --- Configuration ---
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;
const WALLET_TO_CHECK = process.env.NEXT_PUBLIC_WALLET_ADDRESS;
const TARGET_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TARGET_TOKEN_ADDRESS;
const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
const WRAPPED_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_WRAPPED_TOKEN_ADDRESS;
const ROUTER_ADDRESS = process.env.NEXT_PUBLIC_ROUTER_ADDRESS;

const FACTORY_INDEXER_COLLECTION = 'factoryIndexer';
const POSITIONS_COLLECTION = 'positions';
const CONCURRENT_BATCH_SIZE = 10; // Aynı anda işlenecek pair sayısı (RPC limitleri için düşürüldü)
const DATA_FRESHNESS_THRESHOLD_HOURS = 24; // Kaç saatten eski verilerin güncelleneceği
const MAX_RETRIES = 3; // Bir RPC çağrısı için maksimum yeniden deneme sayısı
const RETRY_DELAY_MS = 2000; // Yeniden denemeler arasındaki bekleme süresi (milisaniye)

if (!MONGODB_URI || !MONGODB_DB_NAME || !RPC_URL || !WALLET_TO_CHECK || !TARGET_TOKEN_ADDRESS || !FACTORY_ADDRESS || !WRAPPED_TOKEN_ADDRESS || !ROUTER_ADDRESS) {
    throw new Error('One or more environment variables are not set. Please check your .env file.');
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const factoryContract = new Contract(FACTORY_ADDRESS!, IUniswapV2Factory.abi, provider);
const routerContract = new ethers.Contract(ROUTER_ADDRESS!, RouterABI.abi, provider);

// --- Helper Functions ---

// Helper to introduce a delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const tokenDataCache = new Map<string, { symbol: string; name: string; decimals: number }>();
async function getTokenData(tokenAddress: string) {
    const normalizedAddress = getAddress(tokenAddress);
    if (tokenDataCache.has(normalizedAddress)) {
        return tokenDataCache.get(normalizedAddress)!;
    }
    try {
        const tokenContract = new Contract(normalizedAddress, IUniswapV2ERC20.abi, provider);
        const [symbol, name, decimals] = await Promise.all([
            tokenContract.symbol(),
            tokenContract.name(),
            tokenContract.decimals(),
        ]);
        const data = { symbol, name, decimals: Number(decimals) };
        tokenDataCache.set(normalizedAddress, data);
        return data;
    } catch (error) {
        console.error(`Error fetching data for token ${normalizedAddress}:`, error);
        const errorData = { symbol: 'ERR', name: 'Error', decimals: 18 };
        tokenDataCache.set(normalizedAddress, errorData);
        return errorData;
    }
}

// --- Advanced Price Calculation Logic ---

const priceCache = new Map<string, bigint>();
const PRICE_PRECISION = 18;

const normalizeAddress = (address: string) => getAddress(address);

async function getBestAmountOut(
    tokenInAddress: string,
    tokenOutAddress: string,
    amountIn: bigint
): Promise<{ amount: bigint, path: string[] }> {
    const tIn = normalizeAddress(tokenInAddress);
    const tOut = normalizeAddress(tokenOutAddress);

    if (tIn === tOut) {
        return { amount: amountIn, path: [tokenInAddress] };
    }

    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    try {
        const path = [tokenInAddress, tokenOutAddress];
        const amountsOut = await routerContract.getAmountsOut(amountIn, path);
        const finalAmount = amountsOut[amountsOut.length - 1];
        if (finalAmount > 0n) {
            return { amount: finalAmount, path };
        }
    } catch { }

    const wrappedTokenAddress = WRAPPED_TOKEN_ADDRESS;
    if (!wrappedTokenAddress) return { amount: 0n, path: [] };

    try {
        const pToken = normalizeAddress(wrappedTokenAddress);
        if (pToken !== tIn && pToken !== tOut) {
            const path = [tokenInAddress, wrappedTokenAddress, tokenOutAddress];
            const amountsOut = await routerContract.getAmountsOut(amountIn, path);
            const finalAmount = amountsOut[amountsOut.length - 1];
            if (finalAmount > 0n) {
                return { amount: finalAmount, path };
            }
        }
    } catch { }

    return { amount: 0n, path: [] };
}


async function getPriceInTargetToken(tokenInAddress: string): Promise<bigint> {
    const tokenIn = getAddress(tokenInAddress);
    const targetToken = getAddress(TARGET_TOKEN_ADDRESS!);

    if (tokenIn === targetToken) {
        return 10n ** BigInt(PRICE_PRECISION);
    }

    const cacheKey = `${tokenIn}-${targetToken}`;
    if (priceCache.has(cacheKey)) {
        return priceCache.get(cacheKey)!;
    }

    try {
        const tokenInData = await getTokenData(tokenIn);
        const targetTokenData = await getTokenData(targetToken);
        const amountIn = 10n ** BigInt(tokenInData.decimals);
        const { amount: bestAmountOut } = await getBestAmountOut(tokenIn, targetToken, amountIn);

        if (bestAmountOut === 0n) {
            priceCache.set(cacheKey, 0n);
            return 0n;
        }

        const price = (bestAmountOut * (10n ** BigInt(PRICE_PRECISION))) / (10n ** BigInt(targetTokenData.decimals));
        priceCache.set(cacheKey, price);
        return price;

    } catch (error) {
        console.error(`Could not fetch price for ${tokenInAddress} in terms of ${TARGET_TOKEN_ADDRESS}:`, error);
        priceCache.set(cacheKey, 0n);
        return 0n;
    }
}

// --- Main Logic ---

async function processPair(pairAddress: string): Promise<DbLpPosition | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const pairContract = new Contract(pairAddress, IUniswapV2Pair.abi, provider);
            const balance = await pairContract.balanceOf(WALLET_TO_CHECK);

            if (balance > 0n) {
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

                return {
                    walletAddress: getAddress(WALLET_TO_CHECK!),
                    pairAddress: getAddress(pairAddress),
                    lpBalance: balance.toString(),
                    poolShare: userShare.toString(),
                    totalValueUSD: formatUnits(totalValueInTarget, PRICE_PRECISION),
                    token0: {
                        address: getAddress(token0Address),
                        symbol: token0Data.symbol,
                        route: [],
                    },
                    token1: {
                        address: getAddress(token1Address),
                        symbol: token1Data.symbol,
                        route: [],
                    },
                    estimatedWithdraw: {
                        token0Amount: formatUnits(userAmount0_bigint, token0Data.decimals),
                        token1Amount: formatUnits(userAmount1_bigint, token1Data.decimals),
                        token0ValueInTarget: formatUnits(value0InTarget, PRICE_PRECISION),
                        token1ValueInTarget: formatUnits(value1InTarget, PRICE_PRECISION),
                        totalValueInTarget: formatUnits(totalValueInTarget, PRICE_PRECISION),
                    },
                    updatedAt: new Date(),
                };
            }
            return null; // Balance is zero, successful exit
        } catch (pairError: any) {
            if (pairError.code === 'TIMEOUT' && attempt < MAX_RETRIES) {
                console.warn(`  - Timeout processing pair ${pairAddress}. Retrying in ${RETRY_DELAY_MS / 1000}s... (Attempt ${attempt}/${MAX_RETRIES})`);
                await delay(RETRY_DELAY_MS);
            } else {
                console.error(`  - Error processing pair ${pairAddress} after ${attempt} attempts:`, pairError);
                return null; // Max retries reached or non-timeout error
            }
        }
    }
    return null; // Should not be reached, but for type safety
}


async function updatePositionsFromFactory() {
    console.log('Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI!);
    await client.connect();
    const db = client.db(MONGODB_DB_NAME);
    const factoryCollection = db.collection(FACTORY_INDEXER_COLLECTION);
    const positionsCollection = db.collection<DbLpPosition>(POSITIONS_COLLECTION);
    console.log('Successfully connected to MongoDB.');

    try {
        console.log(`Fetching all unique pair addresses from '${FACTORY_INDEXER_COLLECTION}' collection...`);
        const pairDocuments = await factoryCollection.aggregate([
            { $match: { "parameters.pair": { $exists: true } } },
            { $group: { _id: "$parameters.pair" } }
        ]).toArray();

        const allPairAddresses = pairDocuments.map(doc => getAddress(doc._id));
        console.log(`Found ${allPairAddresses.length} total unique pairs in the factory.`);

        // --- Incremental Update Logic ---
        console.log('Fetching existing positions to determine which pairs to update...');
        const existingPositions = await positionsCollection.find({ walletAddress: getAddress(WALLET_TO_CHECK!) }).toArray();
        const existingPositionsMap = new Map(existingPositions.map(p => [p.pairAddress, p.updatedAt]));

        const thresholdDate = new Date(Date.now() - DATA_FRESHNESS_THRESHOLD_HOURS * 60 * 60 * 1000);

        const pairsToUpdate = allPairAddresses.filter(pairAddress => {
            const lastUpdate = existingPositionsMap.get(pairAddress);
            if (!lastUpdate) {
                return true; // New pair, always update
            }
            return lastUpdate < thresholdDate; // Old pair, update if data is stale
        });

        console.log(`Found ${existingPositions.length} existing positions. After filtering, ${pairsToUpdate.length} pairs need updating (new or stale).`);

        if (pairsToUpdate.length === 0) {
            console.log('All positions are up-to-date. Exiting.');
            return;
        }

        const allActivePositions: DbLpPosition[] = [];
        let processedCount = 0;

        for (let i = 0; i < pairsToUpdate.length; i += CONCURRENT_BATCH_SIZE) {
            const batch = pairsToUpdate.slice(i, i + CONCURRENT_BATCH_SIZE);

            const batchPromises = batch.map(pairAddress => processPair(pairAddress));
            const results = await Promise.all(batchPromises);

            const activePositionsInBatch = results.filter((p): p is DbLpPosition => p !== null);
            if (activePositionsInBatch.length > 0) {
                allActivePositions.push(...activePositionsInBatch);
            }

            processedCount += batch.length;
            console.log(`[${processedCount}/${pairsToUpdate.length}] Processed batch. Found ${activePositionsInBatch.length} new positions in this batch.`);
        }

        console.log(`\nFinished processing. Found a total of ${allActivePositions.length} active positions to update.`);

        if (allActivePositions.length > 0) {
            console.log('Starting bulk write operation to the database...');
            const bulkOps: AnyBulkWriteOperation<DbLpPosition>[] = allActivePositions.map(position => ({
                updateOne: {
                    filter: { walletAddress: position.walletAddress, pairAddress: position.pairAddress },
                    update: { $set: position },
                    upsert: true,
                },
            }));
            await positionsCollection.bulkWrite(bulkOps);
            console.log(`Successfully upserted ${allActivePositions.length} positions.`);
        }

        // Note: The logic for cleaning up old positions might need adjustment.
        // This now only cleans up positions that are no longer found in the factory,
        // but doesn't account for positions that have become zero-balance.
        // A separate cleanup process might be better. For now, we'll keep the existing logic.
        const activePairAddresses = allActivePositions.map(p => p.pairAddress);
        console.log('Cleaning up old/inactive positions...');
        const deleteResult = await positionsCollection.deleteMany({
            walletAddress: getAddress(WALLET_TO_CHECK!),
            pairAddress: { $nin: allPairAddresses } // This should be all pairs from factory, not just updated ones
        });

        if (deleteResult.deletedCount > 0) {
            console.log(`Cleaned up ${deleteResult.deletedCount} old/inactive positions.`);
        }

    } catch (error) {
        console.error('An error occurred during the update process:', error);
    } finally {
        await client.close();
        console.log('Database connection closed.');
    }
}

updatePositionsFromFactory().catch(console.error);
