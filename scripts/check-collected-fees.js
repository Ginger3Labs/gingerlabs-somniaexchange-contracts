const { ethers } = require('hardhat');
const FACTORY_ADDRESS = "0x31015A978c5815EdE29D0F969a17e116BC1866B1".toLowerCase();

async function getTokenInfo(tokenAddress) {
    try {
        const token = await ethers.getContractAt("IERC20", tokenAddress);
        const symbol = await token.symbol();
        const decimals = await token.decimals();
        return { symbol, decimals };
    } catch (error) {
        return { symbol: "???", decimals: 18 };
    }
}

async function formatTokenAmount(amount, decimals) {
    return ethers.utils.formatUnits(amount, decimals);
}

async function checkCollectedFees() {
    try {
        [account] = await ethers.getSigners();
        console.log(`Kontrol eden adres: ${account.address}\n`);

        // Factory kontratına bağlan
        const factory = await ethers.getContractAt("SomniaExchangeFactory", FACTORY_ADDRESS);

        // feeTo adresini al
        const feeToAddress = await factory.feeTo();

        if (feeToAddress === "0x0000000000000000000000000000000000000000") {
            console.log("❌ PROTOKOL KOMİSYONU KAPALI!");
            console.log("Komisyon toplanmıyor. Önce manage-fee.js ile komisyonu açın.");
            return;
        }

        console.log(`🏦 Komisyon Toplayan Adres: ${feeToAddress}\n`);

        // Tüm çiftleri al
        const allPairsLength = await factory.allPairsLength();
        console.log(`📊 Toplam Likidite Havuzu Sayısı: ${allPairsLength.toString()}\n`);

        let totalValueInPools = ethers.BigNumber.from(0);
        console.log("=== HAVUZ BAZLI KOMİSYON DETAYLARI ===");

        for (let i = 0; i < allPairsLength; i++) {
            const pairAddress = await factory.allPairs(i);
            const pair = await ethers.getContractAt("SomniaExchangePair", pairAddress);

            // Token bilgilerini al
            const token0Address = await pair.token0();
            const token1Address = await pair.token1();

            const token0 = await getTokenInfo(token0Address);
            const token1 = await getTokenInfo(token1Address);

            // LP token bakiyesini kontrol et
            const lpBalance = await pair.balanceOf(feeToAddress);

            if (lpBalance.gt(0)) {
                const totalSupply = await pair.totalSupply();
                const reserves = await pair.getReserves();

                // LP token oranına göre havuzdaki token miktarlarını hesapla
                const token0Amount = reserves[0].mul(lpBalance).div(totalSupply);
                const token1Amount = reserves[1].mul(lpBalance).div(totalSupply);

                const formattedToken0 = await formatTokenAmount(token0Amount, token0.decimals);
                const formattedToken1 = await formatTokenAmount(token1Amount, token1.decimals);

                console.log(`\n🔸 Havuz #${i + 1}: ${pairAddress}`);
                console.log(`   ${token0.symbol}-${token1.symbol} Çifti`);
                console.log(`   → ${formattedToken0} ${token0.symbol}`);
                console.log(`   → ${formattedToken1} ${token1.symbol}`);

                // LP token oranını göster
                const lpPercentage = lpBalance.mul(10000).div(totalSupply).toNumber() / 100;
                console.log(`   📊 LP Token Oranı: %${lpPercentage}`);
            }
        }

    } catch (error) {
        console.error("\n❌ Hata oluştu:", error.message);
        console.log("\n💡 Olası çözümler:");
        console.log("1. FACTORY_ADDRESS'i doğru kontrat adresiyle güncelleyin");
        console.log("2. Ağ bağlantınızı kontrol edin");
        console.log("3. Kontratların doğru deploy edildiğinden emin olun");
    }
}

// Ana fonksiyonu çalıştır
checkCollectedFees()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

// Kullanım:
// npx hardhat run scripts/check-collected-fees.js --network somnia 