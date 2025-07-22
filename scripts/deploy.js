const hre = require("hardhat");
require('dotenv').config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // Deploy WSTT contract
    const WSTT = await hre.ethers.getContractFactory("WSTT");
    const wstt = await WSTT.deploy();
    await wstt.waitForDeployment();
    console.log("WSTT deployed to:", wstt.target);

    // Deploy Factory
    const Factory = await hre.ethers.getContractFactory("SomniaExchangeFactory");
    const factory = await Factory.deploy(deployer.address);
    await factory.waitForDeployment();
    console.log("Factory deployed to:", factory.target);

    // Deploy Router
    const Router = await hre.ethers.getContractFactory("SomniaExchangeRouter02");
    const router = await Router.deploy(factory.target, wstt.target);
    await router.waitForDeployment();
    console.log("Router deployed to:", router.target);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });