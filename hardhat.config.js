/**
 * @type import('hardhat/config').HardhatUserConfig
 */

require('@nomiclabs/hardhat-ethers');
require('dotenv').config();

// Private key should be in .env file
const PRIVATE_KEY = process.env.PRIVATE_KEY;

console.log(`PRIVATE_KEY: ${PRIVATE_KEY}`);

module.exports = {
   defaultNetwork: 'hardhat',

   networks: {
      hardhat: {},

      ropsten: {
         url: 'https://pubnodestest.cypherium.io',
         accounts: [PRIVATE_KEY],
         gasPrice: 1750809638,
         chainId: 16164,
      },
      sepolia: {
         url: "",
         accounts: [PRIVATE_KEY],
         chainId: 11155111
      },
      monad: {
         url: "",
         accounts: [PRIVATE_KEY],
      },
      dev: {
         url: 'http://127.0.0.1:8000',
         accounts: [PRIVATE_KEY],
         network_id: '16164',
         gasPrice: 0,
         chainId: 16163,
      },
      somnia: {
         url: "https://rpc.ankr.com/somnia_testnet/6e3fd81558cf77b928b06b38e9409b4677b637118114e83364486294d5ff4811",
         accounts: [PRIVATE_KEY],
         chainId: 50312,
      },
   },
   solidity: {
      compilers: [
         {
            version: '0.5.16',
            settings: {
               optimizer: {
                  enabled: true,
                  runs: 200,
               },
            },
         },
         {
            version: '0.6.6',
            settings: {
               optimizer: {
                  enabled: true,
                  runs: 200,
               },
            },
         },
      ],
   },
   paths: {
      sources: './contracts',
      cache: './cache',
      artifacts: './artifacts',
   },
   mocha: {
      timeout: 20000,
   },
};
