const { ethers } = require("hardhat");

async function main() {
    const SomniaExchangePair = await ethers.getContractFactory("SomniaExchangePair");

    const initCodeHash = ethers.utils.keccak256(SomniaExchangePair.bytecode);

    console.log(`INIT_CODE_HASH: ${initCodeHash}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});