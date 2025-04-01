const hre = require("hardhat");
require('dotenv').config();

async function main() {
    // Deploy Token contract
    const Token = await hre.ethers.getContractFactory("Token");
    const token = await Token.deploy();
    await token.deployed();
    console.log("Token deployed to:", token.address);

    // Deploy WETH contract
    const WETH = await hre.ethers.getContractFactory("WETH");
    const weth = await WETH.deploy();
    await weth.deployed();
    console.log("WETH deployed to:", weth.address);

    // Deploy Multicall contract
    const Multicall = await hre.ethers.getContractFactory("Multicall");
    const multicall = await Multicall.deploy();
    await multicall.deployed();
    console.log("Multicall deployed to:", multicall.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 