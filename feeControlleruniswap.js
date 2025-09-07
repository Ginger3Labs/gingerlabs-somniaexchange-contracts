const ethers = require('ethers');
const SomniaExchangePairABI = require('./dashboard-lp/src/abis/SomniaExchangePair.json').abi;
const SomniaExchangeFactoryABI = require('./dashboard-lp/src/abis/SomniaExchangeFactory.json').abi;
const SomniaExchangeRouterABI = require('./dashboard-lp/src/abis/SomniaExchangeRouter.json').abi;
const ERC20ABI = require('./dashboard-lp/src/abis/IERC20.json').abi;

async function getBestAmountOut(tokenInAddress, tokenOutAddress, amountIn, routerContract) {
    const TIMEOUT = 30000; // 30 seconds timeout
    const tIn = tokenInAddress.toLowerCase();
    const tOut = tokenOutAddress.toLowerCase();

    if (tIn === tOut) {
        return { amount: amountIn, path: [tokenInAddress] };
    }

    // Helper function to handle timeouts
    const withTimeout = (promise) => {
        return Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request timeout')), TIMEOUT)
            )
        ]);
    };

    // Try direct path with retry
    for (let retry = 0; retry < 3; retry++) {
        try {
            const path = [tokenInAddress, tokenOutAddress];
            const amountsOut = await withTimeout(routerContract.getAmountsOut(amountIn, path));
            const finalAmount = amountsOut[amountsOut.length - 1];
            if (finalAmount > 0n) {
                return { amount: finalAmount, path };
            }
            break; // If we get here, amount was 0, no need to retry
        } catch (error) {
            console.log(`Direct path error (attempt ${retry + 1}/3): ${error.message}`);
            if (retry < 2) await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
        }
    }

    // Try through WSOMI with retry
    const WSOMI = '0x046EDe9564A72571df6F5e44d0405360c0f4dCab';
    for (let retry = 0; retry < 3; retry++) {
        try {
            const path = [tokenInAddress, WSOMI, tokenOutAddress];
            const amountsOut = await withTimeout(routerContract.getAmountsOut(amountIn, path));
            const finalAmount = amountsOut[amountsOut.length - 1];
            if (finalAmount > 0n) {
                return { amount: finalAmount, path };
            }
            break; // If we get here, amount was 0, no need to retry
        } catch (error) {
            console.log(`WSOMI path error (attempt ${retry + 1}/3): ${error.message}`);
            if (retry < 2) await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
        }
    }

    return { amount: 0n, path: [] };
}

async function checkAllLPPositions() {
    try {
        console.log('Connecting to network...');
        // Initialize provider with timeout
        const provider = new ethers.JsonRpcProvider('https://sand-shoe:pop-jazz-phone-floor-pong@auth-api.infra.mainnet.somnia.network', undefined, {
            timeout: 30000,
            stallTimeout: 15000
        });

        // Check if provider is connected
        const network = await provider.getNetwork();
        console.log(`Connected to network: ${network.name} (chainId: ${network.chainId})`);

        // Check if we can make basic calls
        const blockNumber = await provider.getBlockNumber();
        console.log(`Current block number: ${blockNumber}`);

        // Contract addresses
        const FACTORY_ADDRESS = '0x6C4853C97b981Aa848C2b56F160a73a46b5DCCD4';
        const ROUTER_ADDRESS = '0xCdE9aFDca1AdAb5b5C6E4F9e16c9802C88Dc7e1A';
        const REFERENCE_TOKEN = '0x28BEc7E30E6faee657a03e19Bf1128AaD7632A00'; // USDC.e
        const YOUR_WALLET = '0x1532982cDC00bd86d4422136Caa444CC068Fc8ef';

        // Initialize contracts
        const factoryContract = new ethers.Contract(FACTORY_ADDRESS, SomniaExchangeFactoryABI, provider);
        const routerContract = new ethers.Contract(ROUTER_ADDRESS, SomniaExchangeRouterABI, provider);

        console.log('Starting to check LP positions...');
        console.log('Getting total pair count...');
        const pairCount = await factoryContract.allPairsLength();
        console.log(`Found ${pairCount} total pairs\n`);

        let totalValueInRef = 0.0;
        const positions = [];

        // Process each pair
        for (let i = 0; i < pairCount; i++) {
            try {
                console.log(`\nChecking pair ${i + 1}/${pairCount}...`);
                const pairAddress = await factoryContract.allPairs(i);
                console.log(`Got pair address: ${pairAddress}`);
                const pairContract = new ethers.Contract(pairAddress, SomniaExchangePairABI, provider);

                // Get LP balance
                console.log(`Checking LP balance for wallet ${YOUR_WALLET}...`);
                const lpBalance = await pairContract.balanceOf(YOUR_WALLET);
                console.log(`LP Balance: ${lpBalance}`);

                // Skip if no LP tokens
                if (lpBalance <= 0) continue;

                // Get token addresses from pair
                console.log('Getting token addresses...');
                const [token0, token1] = await Promise.all([
                    pairContract.token0(),
                    pairContract.token1()
                ]);
                console.log(`Token0: ${token0}`);
                console.log(`Token1: ${token1}`);

                // Get token contracts
                const token0Contract = new ethers.Contract(token0, ERC20ABI, provider);
                const token1Contract = new ethers.Contract(token1, ERC20ABI, provider);

                // Get token details
                const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([
                    token0Contract.symbol(),
                    token1Contract.symbol(),
                    token0Contract.decimals(),
                    token1Contract.decimals()
                ]);

                // Get reserves and total supply
                const [reserves, totalSupply] = await Promise.all([
                    pairContract.getReserves(),
                    pairContract.totalSupply()
                ]);

                // Calculate your token amounts
                const yourToken0 = (reserves[0] * lpBalance) / totalSupply;
                const yourToken1 = (reserves[1] * lpBalance) / totalSupply;
                const poolShare = (Number(lpBalance) * 100) / Number(totalSupply);

                // Calculate value in reference token (USDC.e)
                let token0ValueInRef = 0n;
                let token1ValueInRef = 0n;
                let token0Path = [];
                let token1Path = [];

                if (token0.toLowerCase() === REFERENCE_TOKEN.toLowerCase()) {
                    token0ValueInRef = yourToken0;
                    token0Path = [token0];
                } else {
                    const result = await getBestAmountOut(token0, REFERENCE_TOKEN, yourToken0, routerContract);
                    token0ValueInRef = result.amount;
                    token0Path = result.path;
                }

                if (token1.toLowerCase() === REFERENCE_TOKEN.toLowerCase()) {
                    token1ValueInRef = yourToken1;
                    token1Path = [token1];
                } else {
                    const result = await getBestAmountOut(token1, REFERENCE_TOKEN, yourToken1, routerContract);
                    token1ValueInRef = result.amount;
                    token1Path = result.path;
                }

                const token0ValueInRefNumber = Number(ethers.formatUnits(token0ValueInRef, 6));
                const token1ValueInRefNumber = Number(ethers.formatUnits(token1ValueInRef, 6));
                const totalValueInRefForPair = token0ValueInRefNumber + token1ValueInRefNumber;

                totalValueInRef += totalValueInRefForPair;

                // Store position details
                positions.push({
                    pairAddress,
                    token0: {
                        address: token0,
                        symbol: symbol0,
                        amount: ethers.formatUnits(yourToken0, decimals0),
                        valueInRef: ethers.formatUnits(token0ValueInRef, 6),
                        path: token0Path
                    },
                    token1: {
                        address: token1,
                        symbol: symbol1,
                        amount: ethers.formatUnits(yourToken1, decimals1),
                        valueInRef: ethers.formatUnits(token1ValueInRef, 6),
                        path: token1Path
                    },
                    lpBalance: ethers.formatUnits(lpBalance, 18),
                    poolShare: poolShare.toFixed(4),
                    totalValueInRef: totalValueInRefForPair.toFixed(2),
                    reserves: {
                        reserve0: ethers.formatUnits(reserves[0], decimals0),
                        reserve1: ethers.formatUnits(reserves[1], decimals1)
                    }
                });

                // Print pair details
                if (totalValueInRefForPair > 1) { // Sadece 1 USDC.e üzeri pozisyonları göster
                    console.log(`=== ${symbol0}/${symbol1} Pair ===`);
                    console.log(`Pool Share: %${poolShare.toFixed(4)}`);
                    console.log(`${symbol0}: ${Number(ethers.formatUnits(yourToken0, decimals0)).toFixed(2)} (${Number(ethers.formatUnits(token0ValueInRef, 6)).toFixed(2)} USDC.e)`);
                    console.log(`${symbol1}: ${Number(ethers.formatUnits(yourToken1, decimals1)).toFixed(2)} (${Number(ethers.formatUnits(token1ValueInRef, 6)).toFixed(2)} USDC.e)`);
                    console.log(`Total Value: ${totalValueInRefForPair.toFixed(2)} USDC.e\n`);
                }

            } catch (error) {
                console.error(`Error processing pair ${i}:`, error.message);
            }
        }

        // Print summary
        console.log('\n=== Summary ===');
        console.log(`Total Positions Found: ${positions.length}`);
        console.log(`Total Value in USDC.e: ${Number(totalValueInRef).toFixed(2)}`);

        // Print positions sorted by value
        console.log('\n=== Top Positions by Value ===');
        positions
            .sort((a, b) => Number(b.totalValueInRef) - Number(a.totalValueInRef))
            .filter(pos => Number(pos.totalValueInRef) > 1)
            .slice(0, 5)
            .forEach((pos, index) => {
                console.log(`\n${index + 1}. ${pos.token0.symbol}/${pos.token1.symbol}`);
                console.log(`   Pool Share: %${pos.poolShare}`);
                console.log(`   ${pos.token0.symbol}: ${Number(pos.token0.amount).toFixed(2)} (${Number(pos.token0.valueInRef).toFixed(2)} USDC.e)`);
                console.log(`   ${pos.token1.symbol}: ${Number(pos.token1.amount).toFixed(2)} (${Number(pos.token1.valueInRef).toFixed(2)} USDC.e)`);
                console.log(`   Total Value: ${Number(pos.totalValueInRef).toFixed(2)} USDC.e`);
            });

    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the function
checkAllLPPositions()
    .then(() => {
        console.log('\nScript completed successfully!');
        process.exit(0);
    })
    .catch(error => {
        console.error('\nScript failed:', error);
        process.exit(1);
    });