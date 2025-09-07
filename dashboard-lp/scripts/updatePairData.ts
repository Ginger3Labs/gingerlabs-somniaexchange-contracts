import { ethers } from 'ethers';
import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

// ABIs
import FactoryABI from '../src/abis/SomniaExchangeFactory.json';
import PairABI from '../src/abis/SomniaExchangePair.json';
import ERC20ABI from '../src/abis/IERC20.json';
import RouterABI from '../src/abis/SomniaExchangeRouter.json';

// Libs
import { getBestAmountOut } from '../src/lib/pathfinder';
import { FactoryIndexer, PairInfo } from '../src/types/db';
import { LpPosition } from '../src/types/lp';
import MulticallABI from '../src/abis/Multicall2.json';

const MONGODB_URI = process.env.MONGODB_URI!;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME!;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;
const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS!;
const ROUTER_ADDRESS = process.env.NEXT_PUBLIC_ROUTER_ADDRESS!;
const TARGET_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TARGET_TOKEN_ADDRESS!;
const WALLET_TO_CHECK = process.env.NEXT_PUBLIC_WALLET_ADDRESS!;
const MULTICALL_ADDRESS = process.env.NEXT_PUBLIC_MULTICALL_ADDRESS!;
const PRICE_PRECISION = 18;

async function main() {
    if (!WALLET_TO_CHECK) {
        console.error("Please define NEXT_PUBLIC_WALLET_ADDRESS in your .env.local file.");
        return;
    }

    console.log('Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(MONGODB_DB_NAME);
    console.log('Connected to MongoDB.');

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    console.log(`Connected to RPC: ${RPC_URL}`);

    const pairsCollection = db.collection<PairInfo>('pairs');
    const positionsCollection = db.collection('positions');

    // Step 1: Update general pair data (reserves, prices, TVL)
    console.log('--- Step 1: Updating Pair Data ---');
    const factoryIndexerCollection = db.collection<FactoryIndexer>('factoryIndexer');
    const allPairsFromFactory = await factoryIndexerCollection.find({
        contractAddress: FACTORY_ADDRESS,
        eventName: 'PairCreated',
        processed: true
    }).toArray();

    const pairsToProcess = allPairsFromFactory;
    console.log(`Found ${allPairsFromFactory.length} pairs. Updating TVL and prices...`);

    const decimalsCache = new Map<string, number>();
    const getDecimals = async (tokenAddress: string): Promise<number> => {
        const address = tokenAddress.toLowerCase();
        if (decimalsCache.has(address)) return decimalsCache.get(address)!;
        try {
            const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI.abi, provider);
            const decimals = await tokenContract.decimals();
            const numDecimals = Number(decimals);
            decimalsCache.set(address, numDecimals);
            return numDecimals;
        } catch {
            console.warn(`Could not fetch decimals for ${tokenAddress}, defaulting to 18.`);
            decimalsCache.set(address, 18);
            return 18;
        }
    };

    const priceCache = new Map<string, { price: string, route: string[] }>();
    const getTokenPrice = async (tokenAddress: string): Promise<{ price: string, route: string[] }> => {
        const address = tokenAddress.toLowerCase();
        if (address === TARGET_TOKEN_ADDRESS.toLowerCase()) return { price: '1.0', route: [TARGET_TOKEN_ADDRESS] };
        if (priceCache.has(address)) return priceCache.get(address)!;

        try {
            const tokenInDecimals = await getDecimals(tokenAddress);
            const amountIn = ethers.parseUnits('1', tokenInDecimals);
            const { amount: bestAmountOut } = await getBestAmountOut(
                tokenAddress, TARGET_TOKEN_ADDRESS, amountIn, ROUTER_ADDRESS, FACTORY_ADDRESS, provider
            );

            if (bestAmountOut === 0n) {
                priceCache.set(address, { price: '0', route: [] });
                return { price: '0', route: [] };
            }

            const targetTokenDecimals = await getDecimals(TARGET_TOKEN_ADDRESS);
            const priceString = ethers.formatUnits(bestAmountOut, targetTokenDecimals);
            const result = { price: priceString, route: [] }; // Route info can be added if needed
            priceCache.set(address, result);
            return result;
        } catch (error) {
            console.error(`Failed to get price for ${tokenAddress}:`, error);
            return { price: '0', route: [] };
        }
    };

    for (const pairData of pairsToProcess) {
        const pairAddress = pairData.parameters.pair;
        const token0Address = pairData.parameters.token0;
        const token1Address = pairData.parameters.token1;

        try {
            const pairContract = new ethers.Contract(pairAddress, PairABI.abi, provider);
            const reserves = await pairContract.getReserves();
            const [reserve0, reserve1, blockTimestampLast] = reserves;

            const [token0Decimals, token1Decimals] = await Promise.all([
                getDecimals(token0Address),
                getDecimals(token1Address)
            ]);

            const [price0Result, price1Result] = await Promise.all([
                getTokenPrice(token0Address),
                getTokenPrice(token1Address)
            ]);

            const token0Price = ethers.parseUnits(price0Result.price, PRICE_PRECISION);
            const token1Price = ethers.parseUnits(price1Result.price, PRICE_PRECISION);

            const bn_reserves0 = BigInt(reserve0.toString());
            const bn_reserves1 = BigInt(reserve1.toString());
            const bn_ten = 10n;

            const poolTvl0 = (bn_reserves0 * token0Price) / (bn_ten ** BigInt(token0Decimals));
            const poolTvl1 = (bn_reserves1 * token1Price) / (bn_ten ** BigInt(token1Decimals));

            // Use the smaller of the two values for a more reliable TVL
            const reliableTotalPoolTvl = poolTvl0 < poolTvl1 ? poolTvl0 * 2n : poolTvl1 * 2n;
            const tvl = parseFloat(ethers.formatUnits(reliableTotalPoolTvl, PRICE_PRECISION));

            const updatedPairInfo: PairInfo = {
                address: pairAddress,
                token0: token0Address,
                token1: token1Address,
                reserves: {
                    reserve0: reserve0.toString(),
                    reserve1: reserve1.toString(),
                    blockTimestampLast: Number(blockTimestampLast),
                },
                tvl: tvl,
                price0: price0Result.price,
                price1: price1Result.price,
                lastUpdatedAt: new Date(),
            };

            await pairsCollection.updateOne(
                { address: pairAddress },
                { $set: updatedPairInfo },
                { upsert: true }
            );

            console.log(`Updated TVL/price for pair ${pairAddress}`);
        } catch (error) {
            console.error(`Failed to update TVL/price for pair ${pairAddress}:`, error);
        }
    }
    console.log('--- Pair Data Update Complete ---');

    // Step 2: Calculate and store positions for the target wallet
    console.log(`\n--- Step 2: Calculating Positions for ${WALLET_TO_CHECK} ---`);
    const pairAddressesToProcess = pairsToProcess.map(p => p.parameters.pair);
    const updatedPairs = await pairsCollection.find({ address: { $in: pairAddressesToProcess } }).toArray();
    if (updatedPairs.length === 0) {
        console.log("No pair data found in DB. Cannot calculate positions.");
        await client.close();
        return;
    }

    const multicall = new ethers.Contract(MULTICALL_ADDRESS, MulticallABI.abi, provider);
    const pairInterface = new ethers.Interface(PairABI.abi);

    // Batching the multicall to avoid overwhelming the RPC
    const batchSize = 10;
    let allResults = [];
    console.log(`Batching multicall requests in sizes of ${batchSize}...`);
    for (let i = 0; i < updatedPairs.length; i += batchSize) {
        const batch = updatedPairs.slice(i, i + batchSize);
        const calls = batch.map(p => ({
            target: p.address,
            callData: pairInterface.encodeFunctionData('balanceOf', [WALLET_TO_CHECK])
        }));
        try {
            const batchCallResult = await multicall.tryAggregate.staticCall(false, calls);
            const batchResults = batchCallResult[1]; // The second element is the array of results
            allResults.push(...batchResults);
            console.log(`Processed batch ${i / batchSize + 1}...`);
        } catch (e) {
            console.error(`Error processing batch ${i / batchSize + 1}:`, e);
            // Fill results for this failed batch with failure statuses
            allResults.push(...calls.map(() => ({ success: false, returnData: '0x' })));
        }
    }
    console.log('All batches processed.');

    const results = allResults;

    const symbolCache = new Map<string, string>();
    const getSymbol = async (tokenAddress: string): Promise<string> => {
        if (symbolCache.has(tokenAddress)) return symbolCache.get(tokenAddress)!;
        try {
            const contract = new ethers.Contract(tokenAddress, ERC20ABI.abi, provider);
            const symbol = await contract.symbol();
            symbolCache.set(tokenAddress, symbol);
            return symbol;
        } catch { return '???'; }
    };

    const positionPromises = updatedPairs.map(async (pair, index): Promise<LpPosition | null> => {
        const { success, returnData } = results[index];
        if (!success || returnData === '0x') return null;

        const balance = BigInt(pairInterface.decodeFunctionResult('balanceOf', returnData)[0].toString());
        if (balance === 0n) return null;

        const tvl = pair.tvl ?? 0;
        if (tvl === 0) return null;

        const pairContract = new ethers.Contract(pair.address, PairABI.abi, provider);
        const totalSupply = await pairContract.totalSupply();
        if (BigInt(totalSupply) === 0n) return null;

        const [token0Symbol, token1Symbol] = await Promise.all([
            getSymbol(pair.token0),
            getSymbol(pair.token1)
        ]);

        if (!pair.reserves) return null; // Skip if reserves are not available

        const positionValue = (tvl * Number(balance)) / Number(totalSupply);

        // Calculate underlying token amounts for the user's position
        const reserve0 = BigInt(pair.reserves.reserve0);
        const reserve1 = BigInt(pair.reserves.reserve1);
        const userToken0Amount = (reserve0 * balance) / BigInt(totalSupply);
        const userToken1Amount = (reserve1 * balance) / BigInt(totalSupply);

        const [token0Decimals, token1Decimals, targetTokenDecimals] = await Promise.all([
            getDecimals(pair.token0),
            getDecimals(pair.token1),
            getDecimals(TARGET_TOKEN_ADDRESS)
        ]);

        // Estimate withdrawal values
        const { amount: token0ValueInTargetBigInt, path: path0 } = await getBestAmountOut(pair.token0, TARGET_TOKEN_ADDRESS, userToken0Amount, ROUTER_ADDRESS, FACTORY_ADDRESS, provider);
        const { amount: token1ValueInTargetBigInt, path: path1 } = await getBestAmountOut(pair.token1, TARGET_TOKEN_ADDRESS, userToken1Amount, ROUTER_ADDRESS, FACTORY_ADDRESS, provider);

        const token0ValueInTarget = ethers.formatUnits(token0ValueInTargetBigInt, targetTokenDecimals);
        const token1ValueInTarget = ethers.formatUnits(token1ValueInTargetBigInt, targetTokenDecimals);
        const totalValueInTarget = (parseFloat(token0ValueInTarget) + parseFloat(token1ValueInTarget)).toString();

        return {
            pairAddress: pair.address,
            token0: {
                address: pair.token0,
                symbol: token0Symbol,
                route: path0
            },
            token1: {
                address: pair.token1,
                symbol: token1Symbol,
                route: path1
            },
            lpBalance: ethers.formatEther(balance),
            poolShare: (Number((balance * 10000n) / BigInt(totalSupply)) / 100).toFixed(2),
            totalValueUSD: positionValue.toFixed(2),
            estimatedWithdraw: {
                token0Amount: ethers.formatUnits(userToken0Amount, token0Decimals),
                token1Amount: ethers.formatUnits(userToken1Amount, token1Decimals),
                token0ValueInTarget: token0ValueInTarget,
                token1ValueInTarget: token1ValueInTarget,
                totalValueInTarget: totalValueInTarget
            }
        };
    });

    const positions = (await Promise.all(positionPromises)).filter((p): p is LpPosition => p !== null);

    // Step 3: Save positions to the database
    const walletAddressLower = WALLET_TO_CHECK.toLowerCase();
    if (positions.length > 0) {
        console.log(`Found ${positions.length} positions for ${WALLET_TO_CHECK}. Saving to database...`);
        await positionsCollection.deleteMany({ walletAddress: walletAddressLower });
        const documentsToInsert = positions.map(p => ({ ...p, walletAddress: walletAddressLower, lastUpdatedAt: new Date() }));
        await positionsCollection.insertMany(documentsToInsert);
        console.log('Successfully saved positions.');
    } else {
        console.log(`No positions found for wallet ${WALLET_TO_CHECK}.`);
        await positionsCollection.deleteMany({ walletAddress: walletAddressLower });
    }

    console.log('--- Position Calculation Complete ---');
    await client.close();
    console.log('MongoDB connection closed.');
}

main().catch(console.error);