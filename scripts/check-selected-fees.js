const { ethers } = require('hardhat');
const FACTORY_ADDRESS = "0x31015A978c5815EdE29D0F969a17e116BC1866B1".toLowerCase();

// Kontrol edilecek pair'ları buraya ekleyin
const PAIRS_TO_CHECK = [
    // Örnek pair adresleri (bunları kendi pair adreslerinizle değiştirin):
    "0x70aD9FC9c2Bce246265057308a9CD54a50EAE88D",
    "0xF690A428cA2d499a9C6B86d0cCfAA0AbFDF81e53",
    "0xa9144daD8471d6Ce111567b0F07AEdcA11f07dbC"
];

async function getTokenInfo(tokenAddress) {
    try {
        const token = await ethers.getContractAt("UniswapV2ERC20", tokenAddress);
        let symbol = "???";
        let decimals = 18;

        try {
            symbol = await token.symbol();
        } catch (error) {
            console.log(`   ⚠️ Token sembolü okunamadı: ${tokenAddress}`);
        }

        try {
            decimals = await token.decimals();
        } catch (error) {
            console.log(`   ⚠️ Token decimal'ı okunamadı, varsayılan: 18`);
        }

        return { symbol, decimals };
    } catch (error) {
        return { symbol: "???", decimals: 18 };
    }
}

async function formatTokenAmount(amount, decimals) {
    return ethers.utils.formatUnits(amount, decimals);
}

async function checkSelectedPairFees() {
    try {
        [account] = await ethers.getSigners();
        console.log(`Kontrol eden adres: ${account.address}\n`);

        // Factory kontratına bağlan
        const factory = await ethers.getContractAt("UniswapV2Factory", FACTORY_ADDRESS);

        // feeTo adresini al
        const feeToAddress = await factory.feeTo();

        if (feeToAddress === "0x0000000000000000000000000000000000000000") {
            console.log("❌ PROTOKOL KOMİSYONU KAPALI!");
            console.log("Komisyon toplanmıyor. Önce manage-fee.js ile komisyonu açın.");
            return;
        }

        console.log(`🏦 Komisyon Toplayan Adres: ${feeToAddress}\n`);
        console.log(`📊 Kontrol Edilecek Pair Sayısı: ${PAIRS_TO_CHECK.length}\n`);

        let totalValueInPools = ethers.BigNumber.from(0);
        console.log("=== SEÇİLEN HAVUZLARIN KOMİSYON DETAYLARI ===");

        for (let i = 0; i < PAIRS_TO_CHECK.length; i++) {
            const pairAddress = PAIRS_TO_CHECK[i];

            try {
                const pair = await ethers.getContractAt("UniswapV2Pair", pairAddress);

                // Token bilgilerini al
                const token0Address = await pair.token0();
                const token1Address = await pair.token1();

                const token0 = await getTokenInfo(token0Address);
                const token1 = await getTokenInfo(token1Address);

                // LP token bakiyesini kontrol et
                const lpBalance = await pair.balanceOf(feeToAddress);

                console.log(`\n🔸 Havuz #${i + 1}: ${pairAddress}`);
                console.log(`   ${token0.symbol}-${token1.symbol} Çifti`);

                if (lpBalance.gt(0)) {
                    const totalSupply = await pair.totalSupply();
                    const reserves = await pair.getReserves();

                    // LP token oranına göre havuzdaki token miktarlarını hesapla
                    const token0Amount = reserves[0].mul(lpBalance).div(totalSupply);
                    const token1Amount = reserves[1].mul(lpBalance).div(totalSupply);

                    const formattedToken0 = await formatTokenAmount(token0Amount, token0.decimals);
                    const formattedToken1 = await formatTokenAmount(token1Amount, token1.decimals);

                    console.log(`   → ${formattedToken0} ${token0.symbol}`);
                    console.log(`   → ${formattedToken1} ${token1.symbol}`);

                    // LP token oranını göster
                    const lpPercentage = lpBalance.mul(10000).div(totalSupply).toNumber() / 100;
                    console.log(`   📊 LP Token Oranı: %${lpPercentage}`);
                    console.log(`   💰 Durum: BİRİKMİŞ KOMİSYON VAR`);
                } else {
                    console.log(`   💢 Durum: Komisyon Yok`);
                }

            } catch (error) {
                console.log(`   ❌ Hata: Bu pair adresi geçersiz veya erişilemiyor`);
            }
        }

    } catch (error) {
        console.error("\n❌ Hata oluştu:", error.message);
        console.log("\n💡 Olası çözümler:");
        console.log("1. FACTORY_ADDRESS'i doğru kontrat adresiyle güncelleyin");
        console.log("2. Pair adreslerini doğru formatta girdiğinizden emin olun");
        console.log("3. Ağ bağlantınızı kontrol edin");
    }
}

// Ana fonksiyonu çalıştır
checkSelectedPairFees()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

// Kullanım:
// 1. PAIRS_TO_CHECK array'ine kontrol etmek istediğiniz pair adreslerini ekleyin
// 2. Çalıştırın: npx hardhat run scripts/check-selected-fees.js --network somnia 