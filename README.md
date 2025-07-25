# Deploy contracts of SomniaExchange to Somnia Testnet

This is a Hardhat setup to deploy the necessary contracts of SomniaExchange.
## Generate an account and Get test tokens

You need generate or provide an evm account and it's privatekey using MetaMask or others. We choose the Ropsten test network to deploy SomniaExchange. First, we need to obtain test tokens.

 [Official Faucet](https://testnet.somnia.network/).

## Get Started

Clone repo:
``` 
git clone https://github.com/gingerdex-smart-contracts
cd gingerdex-smart-contracts
```

Install packages:
```
npm i
```

Modify the private keys as you wish in the `hardhat.config.js` file.

Deploy the contracts (somnia testnet):
```
npx hardhat run --network somnia scripts/deploy.js
```

Contracts will be deployed if node is running.

