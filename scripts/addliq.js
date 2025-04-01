const { ethers } = require('hardhat');

const ROUTER_ADDRESS = "0x585751cBCD7F7eC212Cf3C8E4Bed52a021d39E7d";
const TOKEN1_ADDRESS = "0xF205dA83586C26b9E4510dE554122616338b5D0f";
const TOKEN2_ADDRESS = "0xce885b4f5b4fFfa0e2272AB937C2e192EDAa6F15";

async function addNewLiquidity() {
    [account] = await ethers.getSigners();
    const deployerAddress = account.address;

    const routerInstance = await ethers.getContractAt('UniswapV2Router02', ROUTER_ADDRESS);
    const token1Instance = await ethers.getContractAt('Token', TOKEN1_ADDRESS);
    const token2Instance = await ethers.getContractAt('Token', TOKEN2_ADDRESS);

    console.log(`🔄 Approving Router for NewToken1...`);
    await token1Instance.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);

    console.log(`🔄 Approving Router for NewToken2...`);
    await token2Instance.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);

    const blockTime = (await ethers.provider.getBlock("latest")).timestamp;

    console.log(`🚀 Adding Liquidity for NewToken1 & NewToken2...`);
    await routerInstance.addLiquidity(
        TOKEN1_ADDRESS,
        TOKEN2_ADDRESS,
        ethers.utils.parseUnits("1000", 18), // Token1 Amount
        ethers.utils.parseUnits("1000", 18), // Token2 Amount
        0, // Min Token1 (Slippage zero)
        0, // Min Token2 (Slippage zero)
        deployerAddress,
        blockTime + 100,
        { gasLimit: 5000000 }
    );

    console.log("Liquidity added successfully");
    console.log("Pair address:", pairAddress);
}

addNewLiquidity()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Error:", error);
        process.exit(1);
    });

