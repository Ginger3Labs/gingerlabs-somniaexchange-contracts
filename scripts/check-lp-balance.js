const { ethers } = require('hardhat');

async function checkLPBalance() {
    try {
        [account] = await ethers.getSigners();
        console.log(`Kontrol eden adres: ${account.address}`);

        const FACTORY_ADDRESS = "0x31015A978c5815EdE29D0F969a17e116BC1866B1".toLowerCase();
        const YOUR_WALLET = "0xD8976d7D8F18e536827113dc3707c55f15FC8915";

        // Factory kontratına bağlan
        const factory = await ethers.getContractAt("SomniaExchangeFactory", FACTORY_ADDRESS);

        // Tüm pair'ları kontrol et
        const pairCount = await factory.allPairsLength();
        console.log(`=== LP TOKEN BALANCE KONTROLÜ ===`);
        console.log(`Toplam Pair Sayısı: ${pairCount}`);
        console.log(`Kontrol edilen cüzdan: ${YOUR_WALLET}`);

        for (let i = 0; i < pairCount; i++) {
            const pairAddress = await factory.allPairs(i);
            console.log(`\n--- Pair ${i + 1}: ${pairAddress} ---`);

            try {
                // Pair kontratına bağlan
                const pair = await ethers.getContractAt("SomniaExchangePair", pairAddress);

                // Token bilgilerini al
                const token0 = await pair.token0();
                const token1 = await pair.token1();
                const reserves = await pair.getReserves();

                // LP token balance'ı kontrol et
                const lpBalance = await pair.balanceOf(YOUR_WALLET);
                const totalSupply = await pair.totalSupply();

                console.log(`Token0: ${token0}`);
                console.log(`Token1: ${token1}`);
                console.log(`Reserve0: ${ethers.formatEther(reserves[0])}`);
                console.log(`Reserve1: ${ethers.formatEther(reserves[1])}`);
                const lpBalanceFormatted = ethers.formatEther(lpBalance);
                console.log(`Sizin LP Token: ${lpBalanceFormatted}`);
                console.log(`Toplam LP Supply: ${ethers.formatEther(totalSupply)}`);

                if (lpBalance > 0) {
                    const percentage = (lpBalance * 10000n) / totalSupply;
                    console.log(`🟢 Pool Payınız: %${Number(percentage) / 100}`);

                    // Underlying token değerlerini hesapla
                    const token0Amount = (reserves[0] * lpBalance) / totalSupply;
                    const token1Amount = (reserves[1] * lpBalance) / totalSupply;

                    console.log(`💰 Token0 değeri: ${ethers.formatEther(token0Amount)}`);
                    console.log(`💰 Token1 değeri: ${ethers.formatEther(token1Amount)}`);
                } else {
                    console.log(`🔴 Bu pair'da LP token yok`);
                }

            } catch (error) {
                console.log(`❌ Pair kontrol hatası: ${error.message}`);
            }
        }

        // Protocol fee durumu
        const feeTo = await factory.feeTo();
        const isProtocolFeeOn = feeTo !== "0x0000000000000000000000000000000000000000";

        console.log(`\n=== PROTOKOL KOMİSYON DURUMU ===`);
        console.log(`Durum: ${isProtocolFeeOn ? '🟢 AÇIK' : '🔴 KAPALI'}`);
        console.log(`feeTo: ${feeTo}`);

        if (isProtocolFeeOn) {
            console.log(`\n💡 Protokol komisyonu açık olduğu için:`);
            console.log(`   → Swap işlemlerinde LP token birikecek`);
            console.log(`   → Yukarıdaki LP balance'lar artacak`);
            console.log(`   → Bu LP tokenları burn ederek token alabilirsiniz`);
        }

    } catch (error) {
        console.error("❌ Hata oluştu:", error.message);
    }
}

checkLPBalance()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

// Kullanım: npx hardhat run scripts/check-lp-balance.js --network somnia 