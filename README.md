# Deploy contracts of Uniswap V2 to Cypherium

This is a Hardhat setup to deploy the necessary contracts of Uniswap.
## Generate an account and Get test tokens

You need generate or provide an eth account and it's privatekey using MetaMask or others. We choose the Ropsten test network to deploy Uniswap-v2. First, we need to obtain test tokens.

 [Official Faucet](https://testnet.somnia.network/).

## Get Started

Clone repo:
``` 
git clone https://github.com/cypherium/uniswap-contracts-cypherium/
cd uniswap-contracts-cypherium
```

Install packages:
```
npm i
```

Modify the private keys as you wish in the `hardhat.config.js` file.

Deploy the contracts (somnia):
```
npx hardhat run --network somnia scripts/deploy-uniswap.js
```

Contracts will be deployed if node is running.

