const { ethers } = require('hardhat');

async function deploy() {
    const [account] = await ethers.getSigners();
    const deployerAddress = account.address;
    console.log(`Deploying contracts using ${deployerAddress}`);

    const Token = await ethers.getContractFactory('Token');

    const tokenInstance = await Token.deploy('Ginger Tether', 'USDT.g');
    await tokenInstance.deployed();

    console.log("Token contract deployed to:", tokenInstance.address);

    try {
        const totalSupply = await tokenInstance.totalSupply();
        console.log('Total Supply:', ethers.utils.formatUnits(totalSupply, 18));
    } catch (error) {
        console.warn('totalSupply() call failed. Check the contract.');
    }
}

deploy()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
// npx hardhat run scripts/token-deploy.js --network somnia
