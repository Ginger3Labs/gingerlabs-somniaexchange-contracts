const { ethers } = require('hardhat');

// Deploy function
async function deploy() {
   [account] = await ethers.getSigners();
   deployerAddress = account.address;
   console.log(`Deploying contracts using ${deployerAddress}`);

   //Deploy WETH
/*    const wstt = await ethers.getContractFactory('WSOMI');
   const wsttInstance = await wstt.deploy();
   await wsttInstance.waitForDeployment();
   console.log(`WSOMI deployed to : ${wsttInstance.target}`);
   await new Promise(resolve => setTimeout(resolve, 5000)); // 5 saniye bekle */

   //Deploy Factory
/*    const factory = await ethers.getContractFactory('SomniaExchangeFactory');
   const factoryInstance = await factory.deploy(deployerAddress);
   await factoryInstance.waitForDeployment();
   console.log("Factory contract deployed to:", factoryInstance.target);
   await new Promise(resolve => setTimeout(resolve, 10000)); // 5 saniye bekle */

   //Deploy Router passing Factory Address and WETH Address
   const router = await ethers.getContractFactory('SomniaExchangeRouter02');
   const routerInstance = await router.deploy(
      '0x6C4853C97b981Aa848C2b56F160a73a46b5DCCD4',
      '0x046EDe9564A72571df6F5e44d0405360c0f4dCab'
   );
   await routerInstance.waitForDeployment();
   console.log("Router contract deployed to:", routerInstance.target);

   //Deploy Multicall (needed for Interface)
/*    const multicall = await ethers.getContractFactory('Multicall');
   const multicallInstance = await multicall.deploy();
   await multicallInstance.waitForDeployment();
   console.log(`Multicall deployed to : ${multicallInstance.target}`); */

   //Deploy Tokens
/*    const tok1 = await ethers.getContractFactory('Token');
   const tok1Instance = await tok1.deploy('Token1', 'TOK1');
   await tok1Instance.waitForDeployment();
   console.log("Token1 contract deployed to:", tok1Instance.target);

   const tok2 = await ethers.getContractFactory('Token');
   const tok2Instance = await tok2.deploy('Token2', 'TOK2');
   await tok2Instance.waitForDeployment();
   console.log("Token2 contract deployed to:", tok2Instance.target); */

   // Maximum approval amount
   const maxApproval = ethers.MaxUint256;

   //Approve router on tokens with maximum amount
  /*  console.log(`Approving Router on Token1`);
   await tok1Instance.approve(routerInstance.target, maxApproval, {
      gasLimit: 100000
   });
   console.log(`Approving Router on Token2`);
   await tok2Instance.approve(routerInstance.target, maxApproval, {
      gasLimit: 100000
   });

   //Create Pair with Factory and Get Address
   console.log("Creating pair...");
   const createPairTx = await factoryInstance.createPair(tok1Instance.target, tok2Instance.target, {
      gasLimit: 8000000
   });
   await createPairTx.wait(); // Wait for the transaction to be mined
   console.log("Pair created.");

   const lpAddress = await factoryInstance.getPair(
      tok1Instance.target,
      tok2Instance.target
   );
   console.log("Liquidity added successfully");
   console.log("Pair address:", lpAddress); */

   // Get Block TimeStamp and add 20 minutes for deadline
   const blockTime = (await ethers.provider.getBlock()).timestamp;
   const deadline = blockTime + 1200; // 20 minutes in seconds

   // Define amounts
   const amount = ethers.parseEther('1.0'); // 1 token
   const minAmount = ethers.parseEther('0.1'); // 0.1 token minimum

   //Add Liquidity
/*    console.log(`Adding Liquidity...`);
   try {
      const tx = await routerInstance.addLiquidity(
         tok1Instance.target,
         tok2Instance.target,
         amount,
         amount,
         minAmount,
         minAmount,
         deployerAddress,
         deadline,
         {
            gasLimit: 5000000,
            // gasPrice is handled by ethers v6 automatically
         }
      );
      await tx.wait();
      console.log('Liquidity added successfully!');
   } catch (error) {
      console.error('Error adding liquidity:', error.message);
      throw error;
   } */

   // Save deployed addresses
   const deployedAddresses = {
      Router: routerInstance.target,
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
