const { ethers } = require('hardhat');

// New configuration for Token-to-Token liquidity
const ROUTER_ADDRESS = "0x255aF24a5Dc56f524d95D25F2BFb1Be77AE3FEf7";
const TOKEN1_ADDRESS = "0xC063B29CD6B30885783B505aE180B3079e0A2154";
const TOKEN2_ADDRESS = "0x046EDe9564A72571df6F5e44d0405360c0f4dCab";
const LIQUIDITY_TOKEN1_AMOUNT = "2"; // Amount of TOKEN1 to add
const LIQUIDITY_TOKEN2_AMOUNT = "1"; // Amount of TOKEN2 to add

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(`Using account: ${deployer.address}`);

    // Get contract instances
    const router = await ethers.getContractAt('ISomniaExchangeRouter02', ROUTER_ADDRESS);
    const token1 = await ethers.getContractAt('Token', TOKEN1_ADDRESS);
    const token2 = await ethers.getContractAt('Token', TOKEN2_ADDRESS);

    // Get factory address from router and create factory contract instance
    const factoryAddress = await router.factory();
    const factory = await ethers.getContractAt('ISomniaExchangeFactory', factoryAddress);
    console.log(`Factory address: ${factoryAddress}`);

    // Get pair address for TOKEN1 and TOKEN2, or create it if it doesn't exist
    console.log(`Fetching pair for ${TOKEN1_ADDRESS} (TOKEN1) and ${TOKEN2_ADDRESS} (TOKEN2)...`);
    let pairAddress = await factory.getPair(TOKEN1_ADDRESS, TOKEN2_ADDRESS);
    console.log(`Initial pair address: ${pairAddress}`);

    if (pairAddress === '0x0000000000000000000000000000000000000000') {
        console.log("Pair does not exist. Creating it now...");
        const createPairTx = await factory.createPair(TOKEN1_ADDRESS, TOKEN2_ADDRESS);
        await createPairTx.wait();
        console.log("Pair created successfully.");
        
        // Fetch the new pair address
        pairAddress = await factory.getPair(TOKEN1_ADDRESS, TOKEN2_ADDRESS);
        console.log(`New pair address: ${pairAddress}`);
    }

    // Get pair contract instance
    const pair = await ethers.getContractAt('ISomniaExchangePair', pairAddress);

    // Log reserves before adding liquidity
    const reservesBefore = await pair.getReserves();
    // Uniswap sorts tokens, so we need to check the order
    const token0Address = await pair.token0();
    if (token0Address === TOKEN1_ADDRESS) {
        console.log(`Reserves before: Token1=${ethers.formatUnits(reservesBefore[0], 18)}, Token2=${ethers.formatUnits(reservesBefore[1], 18)}`);
    } else {
        console.log(`Reserves before: Token2=${ethers.formatUnits(reservesBefore[0], 18)}, Token1=${ethers.formatUnits(reservesBefore[1], 18)}`);
    }

    // Approve both tokens for the router
    console.log('Approving TOKEN1 for the router...');
    await (await token1.approve(ROUTER_ADDRESS, ethers.parseUnits(LIQUIDITY_TOKEN1_AMOUNT, 18))).wait();
    console.log('TOKEN1 approved.');

    console.log('Approving TOKEN2 for the router...');
    await (await token2.approve(ROUTER_ADDRESS, ethers.parseUnits(LIQUIDITY_TOKEN2_AMOUNT, 18))).wait();
    console.log('TOKEN2 approved.');

    // Check balances before proceeding
    const token1Balance = await token1.balanceOf(deployer.address);
    const token2Balance = await token2.balanceOf(deployer.address);
    console.log(`User's TOKEN1 balance: ${ethers.formatUnits(token1Balance, 18)}`);
    console.log(`User's TOKEN2 balance: ${ethers.formatUnits(token2Balance, 18)}`);

    const requiredToken1 = ethers.parseUnits(LIQUIDITY_TOKEN1_AMOUNT, 18);
    const requiredToken2 = ethers.parseUnits(LIQUIDITY_TOKEN2_AMOUNT, 18);

    if (token1Balance < requiredToken1 || token2Balance < requiredToken2) {
        console.error("Error: Insufficient token balance to add liquidity.");
        process.exit(1);
    }

    // Set deadline
    const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes from now

    console.log(`Adding liquidity for TOKEN1 and TOKEN2...`);
    
    try {
        // Add liquidity for Token-Token pair
        const tx = await router.addLiquidity(
            TOKEN1_ADDRESS,
            TOKEN2_ADDRESS,
            ethers.parseUnits(LIQUIDITY_TOKEN1_AMOUNT, 18),
            ethers.parseUnits(LIQUIDITY_TOKEN2_AMOUNT, 18),
            0, // amountTokenMin - setting to 0 for simplicity
            0, // amountETHMin - setting to 0 for simplicity
            deployer.address,
            deadline
        );

        console.log('Transaction sent, waiting for confirmation...');
        const receipt = await tx.wait();
        console.log(`Liquidity added successfully!`);
        console.log(`Transaction hash: ${receipt.hash}`);

        // Log reserves after adding liquidity
        const newReserves = await pair.getReserves();
        if (token0Address === TOKEN1_ADDRESS) {
            console.log(`Reserves after:  Token1=${ethers.formatUnits(newReserves[0], 18)}, Token2=${ethers.formatUnits(newReserves[1], 18)}`);
        } else {
            console.log(`Reserves after:  Token2=${ethers.formatUnits(newReserves[0], 18)}, Token1=${ethers.formatUnits(newReserves[1], 18)}`);
        }

    } catch (error) {
        console.error('Error adding liquidity:');
        console.error(error);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });