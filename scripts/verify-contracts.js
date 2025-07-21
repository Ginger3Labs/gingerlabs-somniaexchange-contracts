const { run } = require("hardhat");
const { ethers } = require("ethers"); // Import ethers directly
require('dotenv').config();


async function main() {
    const contractAddresses = {
        wstt: "0xd9aEcb91d54D60fc3fD8e7C1C1D58073186440BD",
        factory: "0xC5BC511d77dB2A54ef85A57C406E21c3A7f54C17",
        router: "0x6E4b7201180Dfab02136a39c54f5DAb714610486",
        multicall: "0x2e3B3874B11356071806dB5944a0b3494f3B3D52",
        token1: "0xD0F0d1Fd692e5f65E51a8f89c21302f6C10d9148",
        token2: "0x1149555ADa1D9d312e54b6Bf3DD7B1D6C08086ff"
    };

    // Get deployer address from private key to avoid ethers.getSigners()
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error("Please provide a PRIVATE_KEY in your .env file");
        return;
    }
    const wallet = new ethers.Wallet(privateKey);
    const deployerAddress = wallet.address;
    console.log(`Using deployer address: ${deployerAddress}`);

    console.log("Starting verification process...");

    // Verify WSTT
    await verifyContract("WSTT", contractAddresses.wstt, []);

    // Verify Factory
    await verifyContract("SomniaExchangeFactory", contractAddresses.factory, [deployerAddress]);

    // Verify Router
    await verifyContract("SomniaExchangeRouter02", contractAddresses.router, [contractAddresses.factory, contractAddresses.wstt]);

    // Verify Multicall
    await verifyContract("Multicall", contractAddresses.multicall, []);

    // Verify Token1
    // NOTE: Constructor arguments for generic tokens might need to be adjusted
    // Assuming they were deployed with standard names/symbols for now.
    await verifyContract("Token", contractAddresses.token1, ["Token1", "TKN1"]);
    
    // Verify Token2
    await verifyContract("Token", contractAddresses.token2, ["Token2", "TKN2"]);

    console.log("Verification process finished.");
}

async function verifyContract(contractName, address, constructorArguments) {
    console.log(`Verifying ${contractName} at ${address}...`);
    try {
        await run("verify:verify", {
            address: address,
            constructorArguments: constructorArguments,
        });
        console.log(`Successfully verified ${contractName}`);
    } catch (error) {
        if (error.message.toLowerCase().includes("already verified")) {
            console.log(`${contractName} is already verified.`);
        } else {
            console.error(`Error verifying ${contractName}:`, error.message);
        }
    }
    console.log("---------------------------------");
}


main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });