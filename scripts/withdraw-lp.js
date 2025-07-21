const { ethers } = require('hardhat');

async function withdrawLP() {
    try {
        [account] = await ethers.getSigners();
        console.log(`LP çeken adres: ${account.address}`);

        // Kontrat adresleri
        const ROUTER_ADDRESS = "YOUR_ROUTER_ADDRESS";  // Deploy scriptinden alın
        const PAIR_ADDRESS = "YOUR_PAIR_ADDRESS";      // Hangi pair'dan çekmek istiyorsunuz

        // Çekim tipi: 'all' (hepsi), 'partial' (kısmi), 'check' (sadece bakma)
        const ACTION = "check";
        const PERCENTAGE = 50; // Eğer partial ise, %kaç çekmek istiyorsunuz

        // Router ve Pair kontratlarına bağlan
        const router = await ethers.getContractAt("SomniaExchangeRouter02", ROUTER_ADDRESS);
        const pair = await ethers.getContractAt("SomniaExchangePair", PAIR_ADDRESS);

        // LP token bilgilerini al
        const lpBalance = await pair.balanceOf(account.address);
        const totalSupply = await pair.totalSupply();
        const reserves = await pair.getReserves();
        const token0Address = await pair.token0();
        const token1Address = await pair.token1();

        console.log("=== LP TOKEN DURUMU ===");
        console.log(`Pair Adresi: ${PAIR_ADDRESS}`);
        console.log(`Sizin LP Token: ${ethers.utils.formatEther(lpBalance)}`);
        console.log(`Toplam LP Supply: ${ethers.utils.formatEther(totalSupply)}`);

        if (lpBalance.eq(0)) {
            console.log("❌ LP tokeniniz yok!");
            return;
        }

        // Pool'daki payınızı hesapla
        const poolShare = lpBalance.mul(10000).div(totalSupply);
        console.log(`Pool Payınız: %${poolShare.toNumber() / 100}`);

        // Underlying token miktarlarını hesapla
        const token0Amount = reserves[0].mul(lpBalance).div(totalSupply);
        const token1Amount = reserves[1].mul(lpBalance).div(totalSupply);

        console.log(`\n=== ÇIKARTILA BİLECEK TOKENLAR ===`);
        console.log(`Token0 (${token0Address}): ${ethers.utils.formatEther(token0Amount)}`);
        console.log(`Token1 (${token1Address}): ${ethers.utils.formatEther(token1Amount)}`);

        if (ACTION === "check") {
            console.log("\n💡 Çekmek için ACTION'ı 'all' veya 'partial' yapın");
            return;
        }

        // Çekim miktarını hesapla
        let withdrawAmount;
        if (ACTION === "all") {
            withdrawAmount = lpBalance;
            console.log("\n=== TÜM LP TOKENLARI ÇEKİLİYOR ===");
        } else if (ACTION === "partial") {
            withdrawAmount = lpBalance.mul(PERCENTAGE).div(100);
            console.log(`\n=== LP TOKENLARININ %${PERCENTAGE}'İ ÇEKİLİYOR ===`);
        } else {
            console.log("❌ Geçersiz ACTION! 'all', 'partial', veya 'check' kullanın");
            return;
        }

        console.log(`Çekilecek LP Token: ${ethers.utils.formatEther(withdrawAmount)}`);

        // Çekilecek token miktarlarını hesapla
        const withdrawToken0 = token0Amount.mul(withdrawAmount).div(lpBalance);
        const withdrawToken1 = token1Amount.mul(withdrawAmount).div(lpBalance);

        console.log(`Çekilecek Token0: ${ethers.utils.formatEther(withdrawToken0)}`);
        console.log(`Çekilecek Token1: ${ethers.utils.formatEther(withdrawToken1)}`);

        // Slippage tolerance (minimum amounts)
        const slippage = 5; // %5 slippage tolerance
        const minToken0 = withdrawToken0.mul(100 - slippage).div(100);
        const minToken1 = withdrawToken1.mul(100 - slippage).div(100);

        // Deadline (20 dakika)
        const deadline = Math.floor(Date.now() / 1000) + 1200;

        // LP token approval kontrolü
        const allowance = await pair.allowance(account.address, ROUTER_ADDRESS);
        if (allowance.lt(withdrawAmount)) {
            console.log("🔄 LP token approval yapılıyor...");
            const approveTx = await pair.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);
            await approveTx.wait();
            console.log("✅ Approval tamamlandı");
        }

        // Liquidity çek
        console.log("🔄 Liquidity çekiliyor...");
        try {
            const removeTx = await router.removeLiquidity(
                token0Address,
                token1Address,
                withdrawAmount,
                minToken0,
                minToken1,
                account.address,
                deadline,
                {
                    gasLimit: 500000
                }
            );

            console.log(`📋 Transaction hash: ${removeTx.hash}`);
            console.log("⏳ Confirmation bekleniyor...");

            const receipt = await removeTx.wait();
            console.log("🟢 LP Çekimi Başarılı!");
            console.log(`⛽ Gas kullanımı: ${receipt.gasUsed.toString()}`);

            // Final balance kontrolü
            const finalLPBalance = await pair.balanceOf(account.address);
            console.log(`\n=== FİNAL DURUM ===`);
            console.log(`Kalan LP Token: ${ethers.utils.formatEther(finalLPBalance)}`);

        } catch (error) {
            console.error("❌ Çekim hatası:", error.message);
        }

    } catch (error) {
        console.error("❌ Genel hata:", error.message);
        console.log("\n💡 Kontrol edin:");
        console.log("1. ROUTER_ADDRESS ve PAIR_ADDRESS doğru mu?");
        console.log("2. LP tokeniniz var mı?");
        console.log("3. Yeterli gas var mı?");
    }
}

withdrawLP()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

/*
KULLANIM:

1. ROUTER_ADDRESS'i güncelleyin (deploy scriptinden)
2. PAIR_ADDRESS'i güncelleyin (hangi pair'dan çekmek istiyorsunuz)
3. ACTION'ı ayarlayın:
   - "check"   → Sadece ne kadar çekebileceğinizi göster
   - "all"     → Tüm LP tokenları çek
   - "partial" → Belirtilen yüzdeyi çek (PERCENTAGE)

4. Çalıştırın:
   npx hardhat run scripts/withdraw-lp.js --network somnia
*/ 