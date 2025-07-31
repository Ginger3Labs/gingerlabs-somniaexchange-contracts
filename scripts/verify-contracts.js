const { run } = require("hardhat");
const { ethers } = require("ethers"); // Import ethers directly
require('dotenv').config();

/*

Deploying contracts using 0x0C1e323f3e78743458C635967e2Ee80fbd2030fC
WSOMI deployed to : 0x5Bf3883758890eff0F86B14eCdf658485A9E9101
Factory contract deployed to: 0x2713FED1D9175C052857F6D0cBC2489A610124b7
Router contract deployed to: 0xE9ebBD400aA2872d9013de40396C6486B561E992
Multicall deployed to : 0xf213dad4ba6D6bf7A7aa1D8ad86a12481C212999
Token1 contract deployed to: 0x388fD89190b7D1193890954CE0c0604648Ec4261
Token2 contract deployed to: 0x493f980848a2ccdB4425757619e7CA1335dc6933

*/
async function main() {
    const contractAddresses = {
        wstt: "0x5Bf3883758890eff0F86B14eCdf658485A9E9101",
        factory: "0x2713FED1D9175C052857F6D0cBC2489A610124b7",
        router: "0xE9ebBD400aA2872d9013de40396C6486B561E992",
        multicall: "0xf213dad4ba6D6bf7A7aa1D8ad86a12481C212999",
        token1: "0x388fD89190b7D1193890954CE0c0604648Ec4261",
        token2: "0x493f980848a2ccdB4425757619e7CA1335dc6933"
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

    // Verify WSOMI
    await verifyContract("WSOMI", contractAddresses.wstt, []);

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