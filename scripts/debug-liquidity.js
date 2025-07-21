const { ethers } = require("hardhat");
require('dotenv').config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Using account:", deployer.address);

    const contractAddresses = {
        factory: "0xC5BC511d77dB2A54ef85A57C406E21c3A7f54C17",
        token1: "0xD0F0d1Fd692e5f65E51a8f89c21302f6C10d9148",
        token2: "0x1149555ADa1D9d312e54b6Bf3DD7B1D6C08086ff"
    };

    // Get contract instances
    const factoryInstance = await ethers.getContractAt("SomniaExchangeFactory", contractAddresses.factory);
    const token1Address = contractAddresses.token1;
    const token2Address = contractAddresses.token2;

    console.log("Checking for existing pair...");
    const pairAddress = await factoryInstance.getPair(token1Address, token2Address);
    console.log(`getPair returned: ${pairAddress}`);

    if (pairAddress === '0x0000000000000000000000000000000000000000') {
        console.log("Pair does not exist. Attempting to create pair...");
        try {
            const createPairTx = await factoryInstance.createPair(token1Address, token2Address, { gasLimit: 3000000 });
            console.log("createPair transaction sent. Waiting for confirmation...");
            const receipt = await createPairTx.wait();
            console.log("Pair created successfully. Transaction hash:", receipt.transactionHash);
            
            const newPairAddress = await factoryInstance.getPair(token1Address, token2Address);
            console.log("New pair address:", newPairAddress);

        } catch (error) {
            console.error("Error creating pair:", error.message);
            if (error.data) {
                console.error("Error data:", error.data);
            }
        }
    } else {
        console.log("Pair already exists at:", pairAddress);
    }
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });