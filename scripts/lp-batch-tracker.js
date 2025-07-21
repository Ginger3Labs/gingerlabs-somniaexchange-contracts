const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

// LP Batch verilerini kaydetmek için JSON dosya yolu
const BATCH_DATA_FILE = './lp-batches.json';

async function lpBatchTracker() {
    try {
        [account] = await ethers.getSigners();
        console.log(`LP Batch Tracker - Kullanıcı: ${account.address}`);

        const PAIR_ADDRESS = "YOUR_PAIR_ADDRESS"; // Pair adresinizi girin

        // İşlem tipi: 'add', 'calculate', 'view', 'clear'
        const ACTION = "view";

        // Eğer 'add' ise, yeni batch bilgilerini girin:
        const NEW_BATCH = {
            date: "2024-01-15",                    // Tarih (YYYY-MM-DD)
            token0Amount: "100.0",                 // Yatırılan Token0 miktarı
            token1Amount: "200.0",                 // Yatırılan Token1 miktarı
            lpTokensReceived: "50.0",              // Alınan LP token miktarı
            token0Price: "1.0",                    // O andaki Token0 fiyatı (opsiyonel)
            token1Price: "1.0",                    // O andaki Token1 fiyatı (opsiyonel)
            note: "İlk likidite ekleme"           // Not (opsiyonel)
        };

        // Batch verilerini yükle
        let batchData = loadBatchData();

        // İşlem tipine göre hareket et
        switch (ACTION.toLowerCase()) {
            case 'add':
                await addNewBatch(batchData, NEW_BATCH, PAIR_ADDRESS);
                break;

            case 'calculate':
                await calculateBatchProfit(batchData, PAIR_ADDRESS);
                break;

            case 'view':
                viewAllBatches(batchData);
                break;

            case 'clear':
                clearAllBatches();
                break;

            default:
                console.log("❌ Geçersiz ACTION: 'add', 'calculate', 'view', 'clear'");
        }

    } catch (error) {
        console.error("❌ Hata:", error.message);
    }
}

// Batch verilerini yükle
function loadBatchData() {
    try {
        if (fs.existsSync(BATCH_DATA_FILE)) {
            const data = fs.readFileSync(BATCH_DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.log("⚠️ Batch data yüklenemedi, yeni dosya oluşturuluyor");
    }
    return { batches: [] };
}

// Batch verilerini kaydet
function saveBatchData(data) {
    fs.writeFileSync(BATCH_DATA_FILE, JSON.stringify(data, null, 2));
    console.log(`✅ Batch veriler kaydedildi: ${BATCH_DATA_FILE}`);
}

// Yeni batch ekle
async function addNewBatch(batchData, newBatch, pairAddress) {
    console.log("=== YENİ BATCH EKLENİYOR ===");

    // Pair kontratından mevcut bilgileri al
    const pair = await ethers.getContractAt("SomniaExchangePair", pairAddress);
    const reserves = await pair.getReserves();
    const totalSupply = await pair.totalSupply();

    // Timestamp ekle
    newBatch.timestamp = Math.floor(Date.now() / 1000);
    newBatch.blockNumber = await ethers.provider.getBlockNumber();

    // Pool durumunu kaydet
    newBatch.poolState = {
        reserve0: ethers.utils.formatEther(reserves[0]),
        reserve1: ethers.utils.formatEther(reserves[1]),
        totalSupply: ethers.utils.formatEther(totalSupply)
    };

    // USD değeri hesapla (basit)
    const token0Value = parseFloat(newBatch.token0Amount) * parseFloat(newBatch.token0Price);
    const token1Value = parseFloat(newBatch.token1Amount) * parseFloat(newBatch.token1Price);
    newBatch.totalUSDValue = token0Value + token1Value;

    batchData.batches.push(newBatch);
    saveBatchData(batchData);

    console.log(`📅 Tarih: ${newBatch.date}`);
    console.log(`💰 Yatırım: ${newBatch.token0Amount} Token0 + ${newBatch.token1Amount} Token1`);
    console.log(`🎯 Alınan LP: ${newBatch.lpTokensReceived}`);
    console.log(`💵 Toplam USD: $${newBatch.totalUSDValue}`);
    console.log(`📝 Not: ${newBatch.note}`);
}

// Tüm batch'leri görüntüle
function viewAllBatches(batchData) {
    console.log("=== TÜM LP BATCH'LERİ ===");

    if (batchData.batches.length === 0) {
        console.log("❌ Henüz batch kaydı yok");
        console.log("💡 ACTION = 'add' yaparak batch ekleyin");
        return;
    }

    let totalToken0 = 0;
    let totalToken1 = 0;
    let totalLP = 0;
    let totalUSD = 0;

    batchData.batches.forEach((batch, index) => {
        console.log(`\n--- Batch ${index + 1} ---`);
        console.log(`📅 Tarih: ${batch.date}`);
        console.log(`💰 Yatırım: ${batch.token0Amount} + ${batch.token1Amount}`);
        console.log(`🎯 LP Token: ${batch.lpTokensReceived}`);
        console.log(`💵 USD Değer: $${batch.totalUSDValue}`);
        console.log(`📝 Not: ${batch.note || 'Yok'}`);

        totalToken0 += parseFloat(batch.token0Amount);
        totalToken1 += parseFloat(batch.token1Amount);
        totalLP += parseFloat(batch.lpTokensReceived);
        totalUSD += batch.totalUSDValue;
    });

    console.log(`\n=== TOPLAM YATIRIM ===`);
    console.log(`Token0: ${totalToken0}`);
    console.log(`Token1: ${totalToken1}`);
    console.log(`LP Token: ${totalLP}`);
    console.log(`USD Değer: $${totalUSD}`);

    // Weighted average cost basis hesapla
    const avgToken0PerLP = totalToken0 / totalLP;
    const avgToken1PerLP = totalToken1 / totalLP;
    const avgUSDPerLP = totalUSD / totalLP;

    console.log(`\n=== ORTALAMA COST BASIS ===`);
    console.log(`LP başına Token0: ${avgToken0PerLP.toFixed(4)}`);
    console.log(`LP başına Token1: ${avgToken1PerLP.toFixed(4)}`);
    console.log(`LP başına USD: $${avgUSDPerLP.toFixed(2)}`);
}

// Batch bazında kâr hesapla
async function calculateBatchProfit(batchData, pairAddress) {
    console.log("=== BATCH BAZINDA KÂR HESAPLAMA ===");

    if (batchData.batches.length === 0) {
        console.log("❌ Hesaplanacak batch yok");
        return;
    }

    // Mevcut pool durumunu al
    const pair = await ethers.getContractAt("SomniaExchangePair", pairAddress);
    const [currentLPBalance, totalSupply, reserves] = await Promise.all([
        pair.balanceOf((await ethers.getSigners())[0].address),
        pair.totalSupply(),
        pair.getReserves()
    ]);

    // Mevcut LP başına token değeri
    const currentToken0PerLP = reserves[0].mul(ethers.utils.parseEther("1")).div(totalSupply);
    const currentToken1PerLP = reserves[1].mul(ethers.utils.parseEther("1")).div(totalSupply);

    console.log(`\n=== MEVCUT DURUM ===`);
    console.log(`Toplam LP Token: ${ethers.utils.formatEther(currentLPBalance)}`);
    console.log(`LP başına Token0: ${ethers.utils.formatEther(currentToken0PerLP)}`);
    console.log(`LP başına Token1: ${ethers.utils.formatEther(currentToken1PerLP)}`);

    // Her batch için kâr hesapla
    let totalCostBasisToken0 = 0;
    let totalCostBasisToken1 = 0;
    let totalLPInvested = 0;

    console.log(`\n=== BATCH DETAYLARI ===`);

    batchData.batches.forEach((batch, index) => {
        const lpAmount = parseFloat(batch.lpTokensReceived);

        // Cost basis (ne kadar yatırdık)
        const costToken0 = parseFloat(batch.token0Amount);
        const costToken1 = parseFloat(batch.token1Amount);

        // Mevcut değer (şu an ne kadar değer)
        const currentValueToken0 = parseFloat(ethers.utils.formatEther(currentToken0PerLP)) * lpAmount;
        const currentValueToken1 = parseFloat(ethers.utils.formatEther(currentToken1PerLP)) * lpAmount;

        // Kâr/Zarar
        const profitToken0 = currentValueToken0 - costToken0;
        const profitToken1 = currentValueToken1 - costToken1;
        const profitPercentage = ((currentValueToken0 + currentValueToken1) / (costToken0 + costToken1) - 1) * 100;

        console.log(`\n--- Batch ${index + 1} (${batch.date}) ---`);
        console.log(`LP Token: ${lpAmount}`);
        console.log(`Yatırım → Şu an:`);
        console.log(`  Token0: ${costToken0} → ${currentValueToken0.toFixed(4)} (${profitToken0 >= 0 ? '+' : ''}${profitToken0.toFixed(4)})`);
        console.log(`  Token1: ${costToken1} → ${currentValueToken1.toFixed(4)} (${profitToken1 >= 0 ? '+' : ''}${profitToken1.toFixed(4)})`);
        console.log(`Kâr/Zarar: ${profitPercentage >= 0 ? '+' : ''}${profitPercentage.toFixed(2)}% ${profitPercentage >= 0 ? '🟢' : '🔴'}`);

        totalCostBasisToken0 += costToken0;
        totalCostBasisToken1 += costToken1;
        totalLPInvested += lpAmount;
    });

    // Toplam kâr/zarar
    const totalCurrentValueToken0 = parseFloat(ethers.utils.formatEther(currentToken0PerLP)) * totalLPInvested;
    const totalCurrentValueToken1 = parseFloat(ethers.utils.formatEther(currentToken1PerLP)) * totalLPInvested;

    const totalProfitToken0 = totalCurrentValueToken0 - totalCostBasisToken0;
    const totalProfitToken1 = totalCurrentValueToken1 - totalCostBasisToken1;
    const totalProfitPercentage = ((totalCurrentValueToken0 + totalCurrentValueToken1) / (totalCostBasisToken0 + totalCostBasisToken1) - 1) * 100;

    console.log(`\n=== TOPLAM SONUÇ ===`);
    console.log(`Toplam Yatırım: ${totalCostBasisToken0.toFixed(4)} + ${totalCostBasisToken1.toFixed(4)}`);
    console.log(`Mevcut Değer: ${totalCurrentValueToken0.toFixed(4)} + ${totalCurrentValueToken1.toFixed(4)}`);
    console.log(`Net Kâr/Zarar: ${totalProfitToken0 >= 0 ? '+' : ''}${totalProfitToken0.toFixed(4)} + ${totalProfitToken1 >= 0 ? '+' : ''}${totalProfitToken1.toFixed(4)}`);
    console.log(`Toplam ROI: ${totalProfitPercentage >= 0 ? '+' : ''}${totalProfitPercentage.toFixed(2)}% ${totalProfitPercentage >= 0 ? '🟢' : '🔴'}`);
}

// Tüm batch'leri temizle
function clearAllBatches() {
    const emptyData = { batches: [] };
    saveBatchData(emptyData);
    console.log("🗑️ Tüm batch veriler temizlendi");
}

lpBatchTracker()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

/*
KULLANIM:

1. PAIR_ADDRESS'i güncelleyin

2. ACTION'ı seçin:
   - "add"       → Yeni batch ekle
   - "view"      → Tüm batch'leri görüntüle  
   - "calculate" → Kâr/zarar hesapla
   - "clear"     → Tüm verileri temizle

3. Yeni batch eklerken NEW_BATCH objesi güncelleyin

4. Çalıştırın:
   npx hardhat run scripts/lp-batch-tracker.js --network somnia

VERİ KAYDI:
- Tüm veriler lp-batches.json dosyasında saklanır
- Bu dosyayı yedeklemeyi unutmayın!
*/ 