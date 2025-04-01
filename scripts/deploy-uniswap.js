const { ethers } = require('hardhat');

// Deploy function
async function deploy() {
   [account] = await ethers.getSigners();
   deployerAddress = account.address;
   console.log(`Deploying contracts using ${deployerAddress}`);

   //Deploy WETH
   const wstt = await ethers.getContractFactory('WSTT');
   const wsttInstance = await wstt.deploy();
   await wsttInstance.deployed();
   console.log(`WSTT deployed to : ${wsttInstance.address}`);

   //Deploy Factory
   const factory = await ethers.getContractFactory('UniswapV2Factory');
   const factoryInstance = await factory.deploy(deployerAddress);
   await factoryInstance.deployed();
   console.log("Factory contract deployed to:", factoryInstance.address);

   //Deploy Router passing Factory Address and WETH Address
   const router = await ethers.getContractFactory('UniswapV2Router02');
   const routerInstance = await router.deploy(
      factoryInstance.address,
      wsttInstance.address,
      { gasLimit: 5000000 }
   );
   await routerInstance.deployed();
   console.log("Router contract deployed to:", routerInstance.address);

   //Deploy Multicall (needed for Interface)
   const multicall = await ethers.getContractFactory('Multicall');
   const multicallInstance = await multicall.deploy();
   await multicallInstance.deployed();
   console.log(`Multicall deployed to : ${multicallInstance.address}`);

   //Deploy Tokens
   const tok1 = await ethers.getContractFactory('Token');
   const tok1Instance = await tok1.deploy('Token1', 'TOK1');
   await tok1Instance.deployed();
   console.log("Token1 contract deployed to:", tok1Instance.address);

   const tok2 = await ethers.getContractFactory('Token');
   const tok2Instance = await tok2.deploy('Token2', 'TOK2');
   await tok2Instance.deployed();
   console.log("Token2 contract deployed to:", tok2Instance.address);

   // Maximum approval amount
   const maxApproval = ethers.constants.MaxUint256;

   //Approve router on tokens with maximum amount
   console.log(`Approving Router on Token1`);
   await tok1Instance.approve(routerInstance.address, maxApproval, {
      gasLimit: 100000
   });
   console.log(`Approving Router on Token2`);
   await tok2Instance.approve(routerInstance.address, maxApproval, {
      gasLimit: 100000
   });

   //Create Pair with Factory and Get Address
   await factoryInstance.createPair(tok1Instance.address, tok2Instance.address, {
      gasLimit: 3000000
   });
   const lpAddress = await factoryInstance.getPair(
      tok1Instance.address,
      tok2Instance.address
   );
   console.log("Liquidity added successfully");
   console.log("Pair address:", lpAddress);

   // Get Block TimeStamp and add 20 minutes for deadline
   const blockTime = (await ethers.provider.getBlock()).timestamp;
   const deadline = blockTime + 1200; // 20 minutes in seconds

   // Define amounts
   const amount = ethers.utils.parseEther('1.0'); // 1 token
   const minAmount = ethers.utils.parseEther('0.1'); // 0.1 token minimum

   //Add Liquidity
   console.log(`Adding Liquidity...`);
   try {
      const tx = await routerInstance.addLiquidity(
         tok1Instance.address,
         tok2Instance.address,
         amount,
         amount,
         minAmount,
         minAmount,
         deployerAddress,
         deadline,
         {
            gasLimit: 5000000,
            gasPrice: await ethers.provider.getGasPrice()
         }
      );
      await tx.wait();
      console.log('Liquidity added successfully!');
   } catch (error) {
      console.error('Error adding liquidity:', error.message);
      throw error;
   }

   // Save deployed addresses
   const deployedAddresses = {
      WETH: wsttInstance.address,
      Factory: factoryInstance.address,
      Router: routerInstance.address,
      Multicall: multicallInstance.address,
      Token1: tok1Instance.address,
      Token2: tok2Instance.address,
      LiquidityPool: lpAddress
   };

   console.log('\nDeployed Addresses:', deployedAddresses);
}

deploy()
   .then(() => process.exit(0))
   .catch((error) => {
      console.error(error);
      process.exit(1);
   });

// npx hardhat run scripts/deploy-uniswap.js --network somnia