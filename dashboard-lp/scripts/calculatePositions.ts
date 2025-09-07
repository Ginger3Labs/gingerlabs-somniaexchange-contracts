import { MongoClient } from 'mongodb';
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
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;

const FACTORY_INDEXER_COLLECTION = 'factoryIndexer';
const POSITIONS_COLLECTION = 'positions';

if (!MONGODB_URI || !MONGODB_DB_NAME || !RPC_URL || !WALLET_TO_CHECK || !TARGET_TOKEN_ADDRESS || !FACTORY_ADDRESS || !WRAPPED_TOKEN_ADDRESS || !ROUTER_ADDRESS) {
    throw new Error('One or more environment variables are not set. Please check your .env file.');
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const factoryContract = new Contract(FACTORY_ADDRESS!, IUniswapV2Factory.abi, provider);
const routerContract = new ethers.Contract(ROUTER_ADDRESS!, RouterABI.abi, provider);

// --- Helper Functions ---

// Cache for token data to avoid redundant RPC calls
const tokenDataCache = new Map<string, { symbol: string; name: string; decimals: number }>();
async function getTokenData(tokenAddress: string) {
    if (tokenDataCache.has(tokenAddress)) {
        return tokenDataCache.get(tokenAddress)!;
    }
    try {
        const tokenContract = new Contract(tokenAddress, IUniswapV2ERC20.abi, provider);
        const [symbol, name, decimals] = await Promise.all([
            tokenContract.symbol(),
            tokenContract.name(),
            tokenContract.decimals(),
        ]);
        const data = { symbol, name, decimals: Number(decimals) };
        tokenDataCache.set(tokenAddress, data);
        return data;
    } catch (error) {
        console.error(`Error fetching data for token ${tokenAddress}:`, error);
        const errorData = { symbol: 'ERR', name: 'Error', decimals: 18 };
        tokenDataCache.set(tokenAddress, errorData);
        return errorData;
    }
}

// --- Advanced Price Calculation Logic (inspired by pathfinder.ts) ---

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

    // --- Aşama 1: Doğrudan Rotayı Kontrol Et (TokenIn -> TokenOut) ---
    try {
        const directPairAddress = await factoryContract.getPair(tIn, tOut);
        if (directPairAddress && directPairAddress !== ZERO_ADDRESS) {
            const path = [tokenInAddress, tokenOutAddress];
            const amountsOut = await routerContract.getAmountsOut(amountIn, path);
            const finalAmount = amountsOut[amountsOut.length - 1];
            if (finalAmount > 0n) {
                return { amount: finalAmount, path };
            }
        }
    } catch {
        // Bu yol geçerli değil, devam et.
    }

    // --- Aşama 2: WRAPPED_TOKEN Üzerinden Tek Adımlı Rota Ara ---
    const wrappedTokenAddress = process.env.NEXT_PUBLIC_WRAPPED_TOKEN_ADDRESS;
    if (!wrappedTokenAddress) {
        return { amount: 0n, path: [] }; // Wrapped token yoksa devam etme
    }

    try {
        const pToken = normalizeAddress(wrappedTokenAddress);
        if (pToken !== tIn && pToken !== tOut) {
            const pair1 = await factoryContract.getPair(tIn, pToken);
            const pair2 = await factoryContract.getPair(pToken, tOut);

            if (pair1 && pair1 !== ZERO_ADDRESS && pair2 && pair2 !== ZERO_ADDRESS) {
                const path = [tokenInAddress, wrappedTokenAddress, tokenOutAddress];
                const amountsOut = await routerContract.getAmountsOut(amountIn, path);
                const finalAmount = amountsOut[amountsOut.length - 1];
                if (finalAmount > 0n) {
                    return { amount: finalAmount, path };
                }
            }
        }
    } catch {
        // Bu yol geçerli değil.
    }

    // Hiçbir rota bulunamadı.
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

        // 1 birim tokenIn'in değerini hesapla
        const amountIn = 10n ** BigInt(tokenInData.decimals);

        const { amount: bestAmountOut } = await getBestAmountOut(tokenIn, targetToken, amountIn);

        if (bestAmountOut === 0n) {
            priceCache.set(cacheKey, 0n);
            return 0n;
        }

        // Fiyatı, 1 tokenIn'in targetToken cinsinden değeri olarak hesapla.
        // Sonuç, PRICE_PRECISION (18) ondalık basamağa sahip olacak şekilde normalize edilir.
        // Formül: price = (amountOut_for_1_tokenIn * 10**PRICE_PRECISION) / 10**targetToken_decimals
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
        console.log(`Found ${allPairAddresses.length} unique pairs.`);

        if (allPairAddresses.length === 0) {
            console.log('No pairs found in the factoryIndexer collection. Exiting.');
            return;
        }

        const activePositions: DbLpPosition[] = [];
        let processedCount = 0;

        for (const pairAddress of allPairAddresses) {
            processedCount++;
            console.log(`[${processedCount}/${allPairAddresses.length}] Checking balance for pair: ${pairAddress}`);

            try {
                const pairContract = new Contract(pairAddress, IUniswapV2Pair.abi, provider);
                const balance = await pairContract.balanceOf(WALLET_TO_CHECK);

                if (balance > 0n) {
                    console.log(`  - Found active position in ${pairAddress} with balance: ${balance.toString()}`);

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

                    // Değer Hesaplaması: (Kullanıcının Token Miktarı * Token Fiyatı) / 10^token_ondalık
                    // price0 ve price1 zaten PRICE_PRECISION'a (18) göre ayarlandığı için,
                    // bu işlem sonucunda çıkan değer de PRICE_PRECISION ondalığına sahip olur.
                    const value0InTarget = (userAmount0_bigint * price0) / (10n ** BigInt(token0Data.decimals));
                    const value1InTarget = (userAmount1_bigint * price1) / (10n ** BigInt(token1Data.decimals));
                    const totalValueInTarget = value0InTarget + value1InTarget;

                    const userShare = Number(balance) / Number(totalSupply);

                    const position: DbLpPosition = {
                        walletAddress: getAddress(WALLET_TO_CHECK!),
                        pairAddress: getAddress(pairAddress),
                        lpBalance: balance.toString(), // Ham BigInt değerini string olarak sakla
                        poolShare: userShare.toString(),
                        totalValueUSD: formatUnits(totalValueInTarget, PRICE_PRECISION), // Okunabilir formata çevir
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
                    activePositions.push(position);

                    await positionsCollection.updateOne(
                        { walletAddress: position.walletAddress, pairAddress: position.pairAddress },
                        { $set: position },
                        { upsert: true }
                    );
                    console.log(`  - Saved position for ${token0Data.symbol}-${token1Data.symbol} to the database.`);
                }
            } catch (pairError) {
                console.error(`  - Error processing pair ${pairAddress}:`, pairError);
            }
        }

        console.log(`\nFinished processing all pairs. Found ${activePositions.length} active positions.`);

        const activePairAddresses = activePositions.map(p => p.pairAddress);
        const deleteResult = await positionsCollection.deleteMany({
            walletAddress: getAddress(WALLET_TO_CHECK!),
            pairAddress: { $nin: activePairAddresses }
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
