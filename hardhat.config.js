/**
 * @type import('hardhat/config').HardhatUserConfig
 */

require('@nomicfoundation/hardhat-ethers');
require("@nomicfoundation/hardhat-verify");
require('dotenv').config();

// Private key should be in .env file
const PRIVATE_KEY = process.env.PRIVATE_KEY;


module.exports = {
   defaultNetwork: 'hardhat',

   networks: {
      hardhat: {},
      'somnia-testnet': {
         url: "https://enterprise.onerpc.com/somnia_testnet?apikey=Ku3gV1hlxVE3wPUH5aeLC126NpZfO2Sg",
         accounts: [PRIVATE_KEY],
         chainId: 50312,
         timeout: 60000,
      },
      'somnia-mainnet': {
         url: "https://api.infra.mainnet.somnia.network/",
         accounts: [PRIVATE_KEY],
         chainId: 5031,
         timeout: 60000,
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
   etherscan: {
      apiKey: {
         'somnia-testnet': 'empty', // As per documentation
         'somnia-mainnet': 'empty' // As per documentation
      },
      customChains: [
         {
            network: "somnia-testnet",
            chainId: 50312,
            urls: {
               apiURL: "https://somnia.w3us.site/api",
               browserURL: "https://somnia.w3us.site"
            }
         },
         {
            network: "somnia-mainnet",
            chainId: 5031,
            urls: {
               apiURL: "https://mainnet.somnia.w3us.site/api",
               browserURL: "https://mainnet.somnia.w3us.site"
            }
         }
      ]
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
