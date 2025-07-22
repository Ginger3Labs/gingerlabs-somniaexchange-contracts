const hre = require("hardhat");
require('dotenv').config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // Deploy WETH contract
    const WETH = await hre.ethers.getContractFactory("WETH");
    const weth = await WETH.deploy();
    await weth.waitForDeployment();
    console.log("WETH deployed to:", weth.target);

    // Deploy Factory
    const Factory = await hre.ethers.getContractFactory("SomniaExchangeFactory");
    const factory = await Factory.deploy(deployer.address);
    await factory.waitForDeployment();
    console.log("Factory deployed to:", factory.target);

    // Deploy Router
    const Router = await hre.ethers.getContractFactory("SomniaExchangeRouter02");
    const router = await Router.deploy(factory.target, weth.target);
    await router.waitForDeployment();
    console.log("Router deployed to:", router.target);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });