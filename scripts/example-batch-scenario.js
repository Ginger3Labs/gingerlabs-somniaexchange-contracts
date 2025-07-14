const { ethers } = require('hardhat');

/*
A KULLANICISI SENARYOSU:

Gün 1:   100 TOK1 + 200 TOK2 → 50 LP token aldı
Gün 10:  200 TOK1 + 400 TOK2 → 80 LP token aldı  
Gün 20:  300 TOK1 + 600 TOK2 → 120 LP token aldı
Gün 80:  Kâr hesaplaması yapacak

Bu senaryoyu simüle etmek için bu scripti kullanın.
*/

async function setupBatchScenario() {
    console.log("=== A KULLANICISI BATCH SENARYOSU ===");
    console.log("Bu script sizin senaryonuzu lp-batch-tracker.js'e nasıl girmeniz gerektiğini gösterir\n");

    // Gerçek pair adresinizi buraya girin
    const PAIR_ADDRESS = "YOUR_PAIR_ADDRESS";

    // Senaryodaki batch'ler
    const scenarios = [
        {
            day: 1,
            date: "2024-01-01",
            action: "İlk likidite ekleme",
            batch: {
                date: "2024-01-01",
                token0Amount: "100.0",
                token1Amount: "200.0",
                lpTokensReceived: "50.0",
                token0Price: "1.0",
                token1Price: "1.0",
                note: "İlk likidite ekleme - Gün 1"
            }
        },
        {
            day: 10,
            date: "2024-01-10",
            action: "İkinci likidite ekleme",
            batch: {
                date: "2024-01-10",
                token0Amount: "200.0",
                token1Amount: "400.0",
                lpTokensReceived: "80.0",
                token0Price: "1.1",
                token1Price: "0.95",
                note: "İkinci likidite ekleme - Gün 10"
            }
        },
        {
            day: 20,
            date: "2024-01-20",
            action: "Üçüncü likidite ekleme",
            batch: {
                date: "2024-01-20",
                token0Amount: "300.0",
                token1Amount: "600.0",
                lpTokensReceived: "120.0",
                token0Price: "1.2",
                token1Price: "0.9",
                note: "Üçüncü likidite ekleme - Gün 20"
            }
        }
    ];

    console.log("📋 SENARYO DETAYLARI:");
    scenarios.forEach(scenario => {
        console.log(`\n--- Gün ${scenario.day} (${scenario.date}) ---`);
        console.log(`İşlem: ${scenario.action}`);
        console.log(`Yatırım: ${scenario.batch.token0Amount} TOK1 + ${scenario.batch.token1Amount} TOK2`);
        console.log(`Alınan LP: ${scenario.batch.lpTokensReceived}`);
        console.log(`Token fiyatları: TOK1=$${scenario.batch.token0Price}, TOK2=$${scenario.batch.token1Price}`);

        const usdValue = parseFloat(scenario.batch.token0Amount) * parseFloat(scenario.batch.token0Price) +
            parseFloat(scenario.batch.token1Amount) * parseFloat(scenario.batch.token1Price);
        console.log(`USD Değer: $${usdValue}`);
    });

    // Toplam özet
    const totalToken0 = scenarios.reduce((sum, s) => sum + parseFloat(s.batch.token0Amount), 0);
    const totalToken1 = scenarios.reduce((sum, s) => sum + parseFloat(s.batch.token1Amount), 0);
    const totalLP = scenarios.reduce((sum, s) => sum + parseFloat(s.batch.lpTokensReceived), 0);
    const totalUSD = scenarios.reduce((sum, s) => {
        return sum + (parseFloat(s.batch.token0Amount) * parseFloat(s.batch.token0Price) +
            parseFloat(s.batch.token1Amount) * parseFloat(s.batch.token1Price));
    }, 0);

    console.log(`\n=== TOPLAM YATIRIM ===`);
    console.log(`Toplam TOK1: ${totalToken0}`);
    console.log(`Toplam TOK2: ${totalToken1}`);
    console.log(`Toplam LP: ${totalLP}`);
    console.log(`Toplam USD: $${totalUSD}`);

    // Weighted average hesaplama
    const avgToken0PerLP = totalToken0 / totalLP;
    const avgToken1PerLP = totalToken1 / totalLP;
    const avgUSDPerLP = totalUSD / totalLP;

    console.log(`\n=== ORTALAMA COST BASIS ===`);
    console.log(`LP başına TOK1: ${avgToken0PerLP.toFixed(4)}`);
    console.log(`LP başına TOK2: ${avgToken1PerLP.toFixed(4)}`);
    console.log(`LP başına USD: $${avgUSDPerLP.toFixed(2)}`);

    console.log(`\n=== BU SENARYOYU KULLANMAK İÇİN ===`);
    console.log(`1. lp-batch-tracker.js dosyasında PAIR_ADDRESS'i güncelleyin`);
    console.log(`2. Her batch için ACTION = "add" yapın ve NEW_BATCH'i güncelleyin:`);

    scenarios.forEach((scenario, index) => {
        console.log(`\n   Batch ${index + 1}:`);
        console.log(`   ACTION = "add"`);
        console.log(`   NEW_BATCH = ${JSON.stringify(scenario.batch, null, 6)}`);
        console.log(`   npx hardhat run scripts/lp-batch-tracker.js --network somnia`);
    });

    console.log(`\n3. Tüm batch'leri ekledikten sonra kâr hesaplamak için:`);
    console.log(`   ACTION = "calculate"`);
    console.log(`   npx hardhat run scripts/lp-batch-tracker.js --network somnia`);

    console.log(`\n📁 VERİ DOSYASI:`);
    console.log(`   Tüm veriler "lp-batches.json" dosyasında saklanacak`);
    console.log(`   Bu dosyayı yedeklemeyi unutmayın!`);

    // ROI hesaplama örneği
    console.log(`\n💡 KÂR HESAPLAMA MANTIGI:`);
    console.log(`   - Her batch için yatırım vs mevcut değer karşılaştırılır`);
    console.log(`   - Weighted average cost basis kullanılır`);
    console.log(`   - Impermanent loss otomatik hesaplanır`);
    console.log(`   - Her batch'in performansı ayrı ayrı gösterilir`);

    // Çekim stratejisi
    console.log(`\n🎯 KÂR ÇEKME STRATEJİSİ:`);
    console.log(`   1. calculateBatchProfit ile toplam kâr oranını öğren`);
    console.log(`   2. Sadece kâr kısmını çekmek için withdraw-lp.js kullan`);
    console.log(`   3. ACTION = "partial" ve kâr oranını PERCENTAGE olarak ayarla`);
}

setupBatchScenario()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

/*
Bu script sadece senaryonuzu gösterir, batch ekleme yapmaz.
Gerçek batch eklemek için lp-batch-tracker.js kullanın.

ÇALIŞMA SIRASI:
1. Bu scripti çalıştır → Senaryoyu gör
2. lp-batch-tracker.js ile batch'leri tek tek ekle  
3. lp-batch-tracker.js ile kâr hesapla
4. withdraw-lp.js ile kâr çek
*/ 