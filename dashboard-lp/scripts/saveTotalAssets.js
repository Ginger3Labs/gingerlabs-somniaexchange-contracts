const { MongoClient } = require('mongodb');
const { ethers } = require('ethers');
const FactoryABI = require('../src/abis/SomniaExchangeFactory.json');
const PairABI = require('../src/abis/SomniaExchangePair.json');
const ERC20ABI = require('../src/abis/IERC20.json');
const RouterABI = require('../src/abis/SomniaExchangeRouter.json');

const MONGO_URI = process.env.MONGODB_URI;
const MONGO_DB_NAME = process.env.MONGODB_DB_NAME;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;
const ROUTER_ADDRESS = process.env.NEXT_PUBLIC_ROUTER_ADDRESS;
const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
const WSTT_ADDRESS = process.env.NEXT_PUBLIC_WSTT_ADDRESS;
const WALLET_TO_CHECK = process.env.NEXT_PUBLIC_WALLET_ADDRESS;
const NEXT_PUBLIC_TRACKED_TOKEN_ADDRESSES = process.env.NEXT_PUBLIC_TRACKED_TOKEN_ADDRESSES || '';

// --- pathfinder.ts'den kopyalanan ve uyarlanan fonksiyon ---
const normalizeAddress = (address) => ethers.getAddress(address).toLowerCase();

async function getBestAmountOut(
    tokenInAddress,
    tokenOutAddress,
    amountIn,
    router,
    factory
) {
    const tIn = normalizeAddress(tokenInAddress);
    const tOut = normalizeAddress(tokenOutAddress);

    if (tIn === tOut) {
        return { amount: amountIn, path: [tokenInAddress] };
    }

    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    try {
        const directPairAddress = await factory.getPair(tIn, tOut);
        if (directPairAddress && directPairAddress !== ZERO_ADDRESS) {
            const path = [tokenInAddress, tokenOutAddress];
            const amountsOut = await router.getAmountsOut(amountIn, path);
            const finalAmount = amountsOut[amountsOut.length - 1];
            if (finalAmount > 0n) {
                return { amount: finalAmount, path };
            }
        }
    } catch (e) { /* Geçerli değil, devam et */ }

    const priorityTokensStr = process.env.NEXT_PUBLIC_PRIORITY_TOKENS || '';
    const priorityTokens = priorityTokensStr.split(',').map(t => t.trim()).filter(Boolean);

    for (const pTokenAddress of priorityTokens) {
        try {
            const pToken = normalizeAddress(pTokenAddress);
            if (pToken === tIn || pToken === tOut) continue;

            const pair1 = await factory.getPair(tIn, pToken);
            const pair2 = await factory.getPair(pToken, tOut);

            if (pair1 && pair1 !== ZERO_ADDRESS && pair2 && pair2 !== ZERO_ADDRESS) {
                const path = [tokenInAddress, pTokenAddress, tokenOutAddress];
                const amountsOut = await router.getAmountsOut(amountIn, path);
                const finalAmount = amountsOut[amountsOut.length - 1];
                if (finalAmount > 0n) {
                    return { amount: finalAmount, path };
                }
            }
        } catch (e) { /* Geçerli değil, devam et */ }
    }

    return { amount: 0n, path: [] };
}

async function saveTrackedTokenBalances(db, provider) {
    if (!NEXT_PUBLIC_TRACKED_TOKEN_ADDRESSES) {
        console.log('No tracked token addresses found in .env, skipping balance check.');
        return;
    }

    const tokenAddresses = NEXT_PUBLIC_TRACKED_TOKEN_ADDRESSES.split(',').map(addr => addr.trim());
    console.log(`Found ${tokenAddresses.length} token(s) to track balances for.`);

    const balancePromises = tokenAddresses.map(async (tokenAddress) => {
        try {
            const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI.abi, provider);
            const [balance, decimals, symbol] = await Promise.all([
                tokenContract.balanceOf(WALLET_TO_CHECK),
                tokenContract.decimals(),
                tokenContract.symbol()
            ]);

            return {
                tokenAddress,
                symbol,
                balance: ethers.formatUnits(balance, decimals),
                timestamp: new Date(),
            };
        } catch (error) {
            console.error(`Failed to get balance for token ${tokenAddress}:`, error.message);
            return null;
        }
    });

    const balances = (await Promise.all(balancePromises)).filter(b => b !== null);

    if (balances.length > 0) {
        const collection = db.collection('trackedTokenBalances');
        const result = await collection.insertMany(balances);
        console.log(`Successfully inserted ${result.insertedCount} token balance documents.`);
    }
}


async function main() {
    console.log('Starting backup process...');
    if (!MONGO_URI || !MONGO_DB_NAME || !RPC_URL || !WALLET_TO_CHECK) {
        console.error("Error: Missing required environment variables.");
        process.exit(1);
    }

    const mongoClient = new MongoClient(MONGO_URI);
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    try {
        // MongoDB'ye Bağlan
        await mongoClient.connect();
        console.log('Successfully connected to MongoDB.');
        const db = mongoClient.db(MONGO_DB_NAME);

        // 1. Takip edilen token bakiyelerini kaydet
        await saveTrackedTokenBalances(db, provider);

        // 2. Toplam LP Varlığını Hesapla ve Kaydet
        console.log('Calculating total LP assets...');
        const factory = new ethers.Contract(FACTORY_ADDRESS, FactoryABI.abi, provider);
        const router = new ethers.Contract(ROUTER_ADDRESS, RouterABI.abi, provider);
        const decimalsCache = new Map();
        const priceCacheSimple = new Map();
        const PRICE_PRECISION = 30;

        const getDecimals = async (tokenAddress) => {
            const address = tokenAddress.toLowerCase();
            if (decimalsCache.has(address)) return decimalsCache.get(address);
            try {
                const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI.abi, provider);
                const decimals = await tokenContract.decimals();
                decimalsCache.set(address, Number(decimals));
                return Number(decimals);
            } catch (e) {
                console.warn(`Could not get decimals for ${tokenAddress}, defaulting to 18.`);
                decimalsCache.set(address, 18); return 18;
            }
        };

        const getTokenPriceSimple = async (tokenAddress) => {
            const address = tokenAddress.toLowerCase();
            if (address === WSTT_ADDRESS.toLowerCase()) return { price: '1.0', route: [WSTT_ADDRESS] };
            if (priceCacheSimple.has(address)) return priceCacheSimple.get(address);

            try {
                const tokenInDecimals = await getDecimals(tokenAddress);
                const amountIn = ethers.parseUnits('1', tokenInDecimals);
                const { amount: bestAmountOut } = await getBestAmountOut(tokenAddress, WSTT_ADDRESS, amountIn, router, factory);

                if (bestAmountOut === 0n) {
                    priceCacheSimple.set(address, { price: '0', route: [] });
                    return { price: '0', route: [] };
                }
                const wsttDecimals = await getDecimals(WSTT_ADDRESS);
                const priceString = ethers.formatUnits(bestAmountOut, wsttDecimals);
                const result = { price: priceString, route: [] };
                priceCacheSimple.set(address, result);
                return result;
            } catch (error) {
                console.error(`Failed to get price for ${tokenAddress} in WSTT:`, error);
                return { price: '0', route: [] };
            }
        };

        let totalPortfolioValueBigInt = 0n;
        const pairCount = await factory.allPairsLength();
        const pairsToScan = Number(pairCount);
        console.log(`Scanning a total of ${pairsToScan} pairs for LP positions...`);

        for (let i = 0; i < pairsToScan; i++) {
            try {
                const pairAddress = await factory.allPairs(i);
                const pairContract = new ethers.Contract(pairAddress, PairABI.abi, provider);
                const balance = await pairContract.balanceOf(WALLET_TO_CHECK);

                if (BigInt(balance) > 0n) {
                    console.log(`Found LP position in pair ${i + 1}/${pairsToScan}: ${pairAddress}`);
                    const [token0Address, token1Address, reserves, totalSupply] = await Promise.all([
                        pairContract.token0(), pairContract.token1(), pairContract.getReserves(), pairContract.totalSupply()
                    ]);

                    if (BigInt(totalSupply) === 0n) continue;

                    const [price0Result, price1Result] = await Promise.all([getTokenPriceSimple(token0Address), getTokenPriceSimple(token1Address)]);
                    const [token0Decimals, token1Decimals] = await Promise.all([getDecimals(token0Address), getDecimals(token1Address)]);

                    const token0Price = ethers.parseUnits(price0Result.price, PRICE_PRECISION);
                    const token1Price = ethers.parseUnits(price1Result.price, PRICE_PRECISION);

                    const bn_balance = BigInt(balance);
                    const bn_totalSupply = BigInt(totalSupply);
                    const bn_reserves0 = BigInt(reserves[0]);
                    const bn_reserves1 = BigInt(reserves[1]);
                    const bn_ten = 10n;

                    const poolTvl0 = (bn_reserves0 * token0Price) / (bn_ten ** BigInt(token0Decimals));
                    const poolTvl1 = (bn_reserves1 * token1Price) / (bn_ten ** BigInt(token1Decimals));
                    const reliableTotalPoolTvl = poolTvl0 < poolTvl1 ? poolTvl0 * 2n : poolTvl1 * 2n;
                    const positionValueWSTT = (reliableTotalPoolTvl * bn_balance) / bn_totalSupply;

                    totalPortfolioValueBigInt += positionValueWSTT;
                }
            } catch (e) {
                console.warn(`Could not process pair at index ${i}. Error: ${e.message}`);
            }
        }

        const wsttDecimals = await getDecimals(WSTT_ADDRESS);
        const totalAssetsValue = ethers.formatUnits(totalPortfolioValueBigInt, PRICE_PRECISION);
        const totalAssetsValueFormatted = ethers.formatUnits(ethers.parseUnits(totalAssetsValue, wsttDecimals), wsttDecimals);

        console.log(`LP calculation complete. Total LP Value: ${totalAssetsValueFormatted} WSTT`);

        const lpAssetsCollection = db.collection('totalAssetsHistory');
        const lpAssets = {
            value: totalAssetsValueFormatted,
            unit: 'WSTT',
            type: 'LP_PORTFOLIO',
            timestamp: new Date(),
        };
        const result = await lpAssetsCollection.insertOne(lpAssets);
        console.log(`Successfully inserted LP portfolio document with _id: ${result.insertedId}`);

    } catch (error) {
        console.error('An error occurred during the backup process:', error);
        process.exit(1);
    } finally {
        await mongoClient.close();
        console.log('MongoDB connection closed.');
    }

    console.log('Backup process finished successfully.');
}

main();