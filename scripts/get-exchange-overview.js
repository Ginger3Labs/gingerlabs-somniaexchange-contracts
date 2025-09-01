const { ethers } = require("hardhat");

// --- CONFIGURATION ---
const FACTORY_ADDRESS = "0x6C4853C97b981Aa848C2b56F160a73a46b5DCCD4";
const ROUTER_ADDRESS = "0xCdE9aFDca1AdAb5b5C6E4F9e16c9802C88Dc7e1A";
// --- END CONFIGURATION ---

// Helper function to get token info safely
async function getTokenInfo(tokenAddress) {
    try {
        // Using a generic ERC20 ABI is safer for unknown tokens
        const token = await ethers.getContractAt("contracts/core/interfaces/IERC20.sol:IERC20", tokenAddress);
        const symbol = await token.symbol();
        const decimals = await token.decimals();
        return { symbol, decimals: Number(decimals) };
    } catch (error) {
        console.warn(`Warning: Could not retrieve info for token ${tokenAddress}. Error: ${error.message}`);
        return { symbol: "UNKNOWN", decimals: 18 }; // Default to 18 decimals for formatting
    }
}

// Helper to format amounts based on decimals
function formatAmount(amount, decimals) {
    return ethers.formatUnits(amount, decimals);
}

async function getExchangeOverview() {
    console.log("=============================================");
    console.log("🔍 SOMNIA EXCHANGE - OVERVIEW REPORT");
    console.log("=============================================");
    console.log(`\n🏭 Factory Address: ${FACTORY_ADDRESS}`);
    console.log(`🧭 Router Address:  ${ROUTER_ADDRESS}`);

    const factory = await ethers.getContractAt("SomniaExchangeFactory", FACTORY_ADDRESS);
    const router = await ethers.getContractAt("SomniaExchangeRouter02", ROUTER_ADDRESS);

    // --- Router WSTT/WETH Address ---
    console.log("\n--- 🔷 Router Configuration ---");
    try {
        const wsttAddress = await router.WETH();
        console.log(`Registered WSTT (WETH) Address: ${wsttAddress}`);
    } catch (e) {
        console.log(`Could not retrieve WSTT/WETH address from the router.`);
    }

    // --- Protocol Fee Status ---
    console.log("\n--- 💰 Protocol Fee Status ---");
    const feeTo = await factory.feeTo();
    const feeToSetter = await factory.feeToSetter();
    const isFeeOn = feeTo !== "0x0000000000000000000000000000000000000000";

    console.log(`Status: ${isFeeOn ? "🟢 ENABLED" : "🔴 DISABLED"}`);
    if (isFeeOn) {
        console.log(`Fee Collector: ${feeTo}`);
    }
    console.log(`Fee Setter (Admin): ${feeToSetter}`);

    // --- Liquidity Pools ---
    console.log("\n--- 🌊 Liquidity Pools ---");
    const pairCount = await factory.allPairsLength();
    console.log(`Total Pools Found: ${pairCount}`);

    if (pairCount == 0) {
        console.log("No liquidity pools have been created yet.");
        console.log("=============================================");
        return;
    }

    for (let i = 0; i < pairCount; i++) {
        const pairAddress = await factory.allPairs(i);
        const pair = await ethers.getContractAt("SomniaExchangePair", pairAddress);

        const [token0Address, token1Address, reserves, totalSupply] = await Promise.all([
            pair.token0(),
            pair.token1(),
            pair.getReserves(),
            pair.totalSupply()
        ]);

        const [token0, token1] = await Promise.all([
            getTokenInfo(token0Address),
            getTokenInfo(token1Address)
        ]);

        console.log(`\n[${i + 1}] Pair: ${token0.symbol}/${token1.symbol}`);
        console.log(`    Address: ${pairAddress}`);
        console.log(`    Tokens:`);
        console.log(`      - ${token0.symbol} (Token0): ${token0Address}`);
        console.log(`      - ${token1.symbol} (Token1): ${token1Address}`);
        console.log(`    Reserves:`);
        console.log(`      - ${formatAmount(reserves[0], token0.decimals)} ${token0.symbol}`);
        console.log(`      - ${formatAmount(reserves[1], token1.decimals)} ${token1.symbol}`);
        console.log(`    Total LP Supply: ${formatAmount(totalSupply, 18)}`);

        // Check for collected fees in this pool
        if (isFeeOn) {
            const lpBalance = await pair.balanceOf(feeTo);
            if (lpBalance.gt(0)) {
                const feeToken0 = reserves[0].mul(lpBalance).div(totalSupply);
                const feeToken1 = reserves[1].mul(lpBalance).div(totalSupply);
                console.log(`    Collected Fees (for ${feeTo.slice(0, 6)}...):`);
                console.log(`      - ${formatAmount(feeToken0, token0.decimals)} ${token0.symbol}`);
                console.log(`      - ${formatAmount(feeToken1, token1.decimals)} ${token1.symbol}`);
            }
        }
    }
    console.log("\n=============================================");
    console.log("✅ Report Complete");
    console.log("=============================================");
}

getExchangeOverview()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("An error occurred during the overview generation:", error);
        process.exit(1);
    });

// npx hardhat run scripts/get-exchange-overview.js --network somnia-mainnet