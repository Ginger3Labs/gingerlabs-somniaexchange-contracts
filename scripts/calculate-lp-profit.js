const { ethers } = require('hardhat');

async function calculateLPProfit() {
    try {
        [account] = await ethers.getSigners();
        console.log(`Kâr hesaplayan adres: ${account.address}`);

        // Bu bilgileri kaydetmiş olmanız gerekiyor:
        const PAIR_ADDRESS = "YOUR_PAIR_ADDRESS";
        const INITIAL_LP_AMOUNT = ethers.utils.parseEther("1.0");     // İlk LP token miktarınız
        const INITIAL_TOKEN0_INVESTED = ethers.utils.parseEther("1.0");

        // İlk yatırdığınız token0
        const INITIAL_TOKEN1_INVESTED = ethers.utils.parseEther("1.0"); // İlk yatırdığınız token1

        // Pair kontratına bağlan
        const pair = await ethers.getContractAt("SomniaExchangePair", PAIR_ADDRESS);

        // Mevcut bilgileri al
        const currentLPBalance = await pair.balanceOf(account.address);
        const totalSupply = await pair.totalSupply();
        const reserves = await pair.getReserves();
        const token0Address = await pair.token0();
        const token1Address = await pair.token1();

        console.log("=== MEVCUT DURUM ===");
        console.log(`Mevcut LP Token: ${ethers.utils.formatEther(currentLPBalance)}`);
        console.log(`Toplam LP Supply: ${ethers.utils.formatEther(totalSupply)}`);

        if (currentLPBalance.eq(0)) {
            console.log("❌ LP tokeniniz yok!");
            return;
        }

        // Mevcut underlying token değerlerini hesapla
        const currentToken0Value = reserves[0].mul(currentLPBalance).div(totalSupply);
        const currentToken1Value = reserves[1].mul(currentLPBalance).div(totalSupply);

        console.log(`\n=== ŞU ANKİ DEĞERİNİZ ===`);
        console.log(`Token0: ${ethers.utils.formatEther(currentToken0Value)}`);
        console.log(`Token1: ${ethers.utils.formatEther(currentToken1Value)}`);

        console.log(`\n=== İLK YATIRIMINIZ ===`);
        console.log(`Token0: ${ethers.utils.formatEther(INITIAL_TOKEN0_INVESTED)}`);
        console.log(`Token1: ${ethers.utils.formatEther(INITIAL_TOKEN1_INVESTED)}`);

        // Kâr hesaplama
        const token0Profit = currentToken0Value.sub(INITIAL_TOKEN0_INVESTED);
        const token1Profit = currentToken1Value.sub(INITIAL_TOKEN1_INVESTED);

        console.log(`\n=== KÂR/ZARAR ===`);
        console.log(`Token0 Kâr: ${ethers.utils.formatEther(token0Profit)} ${token0Profit.gte(0) ? '🟢' : '🔴'}`);
        console.log(`Token1 Kâr: ${ethers.utils.formatEther(token1Profit)} ${token1Profit.gte(0) ? '🟢' : '🔴'}`);

        // Toplam kâr varsa, sadece kâr kısmını çekmek için LP token miktarını hesapla
        if (token0Profit.gt(0) || token1Profit.gt(0)) {
            console.log(`\n=== KÂR ÇEKME STRATEJİSİ ===`);

            // Basit yaklaşım: Kâr oranına göre LP token çek
            const token0ProfitRatio = token0Profit.mul(10000).div(currentToken0Value);
            const token1ProfitRatio = token1Profit.mul(10000).div(currentToken1Value);
            const avgProfitRatio = token0ProfitRatio.add(token1ProfitRatio).div(2);

            const profitLPAmount = currentLPBalance.mul(avgProfitRatio).div(10000);

            console.log(`Tahmini kâr LP token: ${ethers.utils.formatEther(profitLPAmount)}`);
            console.log(`Bu LP tokenı çekerseniz alacağınız:`);

            const profitToken0 = currentToken0Value.mul(profitLPAmount).div(currentLPBalance);
            const profitToken1 = currentToken1Value.mul(profitLPAmount).div(currentLPBalance);

            console.log(`- Token0: ${ethers.utils.formatEther(profitToken0)}`);
            console.log(`- Token1: ${ethers.utils.formatEther(profitToken1)}`);

            // Çekim için gerekli fonksiyon çağrısı
            console.log(`\n💡 Sadece kâr çekmek için:`);
            console.log(`   1. withdraw-lp.js scriptini kullanın`);
            console.log(`   2. ACTION = "partial" yapın`);
            console.log(`   3. PERCENTAGE = ${avgProfitRatio.toNumber() / 100} yapın`);

        } else {
            console.log(`\n❌ Henüz kâr yok veya zarar var`);
            console.log(`💡 Daha fazla swap işlemi olmasını bekleyin`);
        }

        // LP değer artışı hesapla (impermanent loss dahil)
        const initialValue = INITIAL_TOKEN0_INVESTED.add(INITIAL_TOKEN1_INVESTED);
        const currentValue = currentToken0Value.add(currentToken1Value);
        const totalGainLoss = currentValue.sub(initialValue);
        const gainLossPercentage = totalGainLoss.mul(10000).div(initialValue);

        console.log(`\n=== TOPLAM PERFORMANS ===`);
        console.log(`İlk yatırım değeri: ${ethers.utils.formatEther(initialValue)} (total)`);
        console.log(`Şu anki değer: ${ethers.utils.formatEther(currentValue)} (total)`);
        console.log(`Toplam kazanç/kayıp: ${ethers.utils.formatEther(totalGainLoss)} (%${gainLossPercentage.toNumber() / 100})`);

    } catch (error) {
        console.error("❌ Hata:", error.message);
        console.log("\n💡 Bu script için gerekli:");
        console.log("1. PAIR_ADDRESS doğru olmalı");
        console.log("2. İlk yatırım miktarlarını manuel girmeniz gerekiyor");
        console.log("3. LP tokeniniz olmalı");
    }
}

calculateLPProfit()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

/*
Bu script sadece kâr hesaplar, çekmez.
Gerçek çekim için withdraw-lp.js kullanın.

KULLANIM:
1. PAIR_ADDRESS'i güncelleyin
2. İlk yatırım miktarlarınızı girin (INITIAL_TOKEN0_INVESTED, INITIAL_TOKEN1_INVESTED)
3. Çalıştırın: npx hardhat run scripts/calculate-lp-profit.js --network somnia
*/ 