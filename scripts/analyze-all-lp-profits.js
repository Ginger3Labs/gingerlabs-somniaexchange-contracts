const { ethers } = require('hardhat');
const factoryABI = require('../artifacts/contracts/core/SomniaExchangeFactory.sol/SomniaExchangeFactory.json').abi;
const pairABI = require('../artifacts/contracts/core/SomniaExchangePair.sol/SomniaExchangePair.json').abi;
const erc20ABI = require('../artifacts/contracts/core/interfaces/IERC20.sol/IERC20.json').abi;

async function analyzeAllLpProfits() {
    const [account] = await ethers.getSigners();
    const provider = ethers.provider;
    console.log(`Analiz eden cüzdan: ${account.address}`);

    const FACTORY_ADDRESS = "0x31015A978c5815EdE29D0F969a17e116BC1866B1";
    const factory = new ethers.Contract(FACTORY_ADDRESS, factoryABI, provider);

    console.log("Tüm LP pozisyonlarınız taranıyor...");

    const pairCount = await factory.allPairsLength();
    if (pairCount == 0) {
        console.log("Bu fabrikada hiç likidite havuzu (pair) bulunamadı.");
        return;
    }

    for (let i = 0; i < pairCount; i++) {
        const pairAddress = await factory.allPairs(i);
        const pair = new ethers.Contract(pairAddress, pairABI, account);

        const lpBalance = await pair.balanceOf(account.address);

        if (lpBalance > 0) {
            console.log(`\n\n--- Analiz: Pair ${pairAddress} ---`);

            try {
                // 1. Mevcut Değeri Hesapla
                const totalSupply = await pair.totalSupply();
                const reserves = await pair.getReserves();
                const token0Address = await pair.token0();
                const token1Address = await pair.token1();

                const token0Contract = new ethers.Contract(token0Address, erc20ABI, provider);
                const token1Contract = new ethers.Contract(token1Address, erc20ABI, provider);
                const token0Symbol = await token0Contract.symbol();
                const token1Symbol = await token1Contract.symbol();

                const currentToken0Value = (reserves[0] * lpBalance) / totalSupply;
                const currentToken1Value = (reserves[1] * lpBalance) / totalSupply;

                // 2. Başlangıç Yatırımını Bul (RPC limitleri için parçalara bölerek)
                const mintFilter = pair.filters.Mint(account.address);
                const currentBlock = await provider.getBlockNumber();
                // RPC'nin eski blokları budamış olma ihtimaline karşı makul bir başlangıç noktası belirle
                const startBlock = Math.max(0, currentBlock - 100000); // Son 100,000 bloğu tara

                const step = 10000;
                let allMintEvents = [];

                for (let fromBlock = startBlock; fromBlock <= currentBlock; fromBlock += step) {
                    const toBlock = Math.min(fromBlock + step - 1, currentBlock);
                    const mintEvents = await pair.queryFilter(mintFilter, fromBlock, toBlock);
                    allMintEvents = allMintEvents.concat(mintEvents);
                }

                let totalToken0Invested = 0n;
                let totalToken1Invested = 0n;

                if (allMintEvents.length === 0) {
                    console.log("🔴 Bu pozisyon için 'Mint' (likidite ekleme) işlemi bulunamadı. Manuel eklenmiş olabilir.");
                    continue;
                }

                for (const event of allMintEvents) {
                    totalToken0Invested += BigInt(event.args.amount0.toString());
                    totalToken1Invested += BigInt(event.args.amount1.toString());
                }

                // 3. Kar/Zarar Hesapla ve Raporla
                const token0Profit = currentToken0Value - totalToken0Invested;
                const token1Profit = currentToken1Value - totalToken1Invested;

                console.log(` çifti: ${token0Symbol}/${token1Symbol}`);
                console.log("\n--- BAŞLANGIÇ YATIRIMI ---");
                console.log(`-> ${ethers.formatEther(totalToken0Invested)} ${token0Symbol}`);
                console.log(`-> ${ethers.formatEther(totalToken1Invested)} ${token1Symbol}`);

                console.log("\n--- MEVCUT DEĞER ---");
                console.log(`-> ${ethers.formatEther(currentToken0Value)} ${token0Symbol}`);
                console.log(`-> ${ethers.formatEther(currentToken1Value)} ${token1Symbol}`);

                console.log("\n--- KÂR / ZARAR ---");
                console.log(`-> ${ethers.formatEther(token0Profit)} ${token0Symbol} ${token0Profit >= 0 ? '🟢' : '🔴'}`);
                console.log(`-> ${ethers.formatEther(token1Profit)} ${token1Symbol} ${token1Profit >= 0 ? '🟢' : '🔴'}`);

            } catch (error) {
                console.log(`❌ Pair ${pairAddress} analizi sırasında hata: ${error.message}`);
            }
        }
    }
    console.log("\n\nAnaliz tamamlandı.");
}

analyzeAllLpProfits()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
