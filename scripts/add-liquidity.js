const { ethers } = require("hardhat");
require('dotenv').config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Using account:", deployer.address);

    const contractAddresses = {
        wstt: "0xd9aEcb91d54D60fc3fD8e7C1C1D58073186440BD",
        factory: "0xC5BC511d77dB2A54ef85A57C406E21c3A7f54C17",
        router: "0x6E4b7201180Dfab02136a39c54f5DAb714610486",
        multicall: "0x2e3B3874B11356071806dB5944a0b3494f3B3D52",
        token1: "0xD0F0d1Fd692e5f65E51a8f89c21302f6C10d9148",
        token2: "0x1149555ADa1D9d312e54b6Bf3DD7B1D6C08086ff"
    };

    // Get contract instances
    const routerInstance = await ethers.getContractAt("SomniaExchangeRouter02", contractAddresses.router);
    const token1Instance = await ethers.getContractAt("Token", contractAddresses.token1);
    const token2Instance = await ethers.getContractAt("Token", contractAddresses.token2);
    const factoryInstance = await ethers.getContractAt("SomniaExchangeFactory", contractAddresses.factory);

    const token1Amount = ethers.parseEther("100");
    const token2Amount = ethers.parseEther("100");

    // Check balances before proceeding
    const token1Balance = await token1Instance.balanceOf(deployer.address);
    const token2Balance = await token2Instance.balanceOf(deployer.address);
    console.log(`Token1 Balance: ${ethers.formatEther(token1Balance)}`);
    console.log(`Token2 Balance: ${ethers.formatEther(token2Balance)}`);

  /*   if (token1Balance.lt(token1Amount) || token2Balance.lt(token2Amount)) {
        console.error("Insufficient token balance to add liquidity.");
        return;
    } */

    // Approve Router to spend tokens

    console.log("Checking router address...");
    try {
        const routerAddress = await routerInstance.getAddress();
        console.log("Router address from getAddress():", routerAddress);
    } catch (e) {
        console.error("Could not get router address:", e);
    }

    console.log("Approving Router on Token1...");
    const approve1Tx = await token1Instance.approve(await routerInstance.getAddress(), token1Amount);
    await approve1Tx.wait();
    console.log("Token1 approved.");

    console.log("Approving Router on Token2...");
    const approve2Tx = await token2Instance.approve(await routerInstance.getAddress(), token2Amount);
    await approve2Tx.wait();
    console.log("Token2 approved.");

    // Add liquidity
    console.log("Adding Liquidity...");
    try {
        const deadline = Math.floor(Date.now() / 1000) + (60 * 60); // 60 minutes from now
        const addLiquidityTx = await routerInstance.addLiquidity(
                await token1Instance.getAddress(),
                await token2Instance.getAddress(),
                token1Amount,
            token2Amount,
            0, // amountTokenAMin
            0, // amountTokenBMin
            deployer.address,
            deadline,
        { gasLimit: 5000000 }        );
        const receipt = await addLiquidityTx.wait();
        console.log("Liquidity added successfully. Transaction hash:", receipt.transactionHash);


    } catch (error) {
        console.error("Error adding liquidity:", error.message);
        if (error.data) {
            console.error("Error data:", error.data);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });