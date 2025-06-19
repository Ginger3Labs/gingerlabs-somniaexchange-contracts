const { ethers } = require('hardhat');

async function manageFee() {
    try {
        [account] = await ethers.getSigners();
        console.log(`İşlem yapan adres: ${account.address}`);

        // Factory kontrat adresini buraya girin
        const FACTORY_ADDRESS = "0x31015A978c5815EdE29D0F969a17e116BC1866B1".toLowerCase(); // ← Bu adresi güncelleyin!

        // İşlem seçin: 'enable', 'disable', 'check'
        const ACTION = "enable"; // ← Burası değiştir: "enable", "disable", "check"

        // Eğer enable ediyorsanız, komisyonu alacak adresi buraya girin
        const FEE_RECEIVER_ADDRESS = ethers.utils.getAddress("0xD8976d7D8F18e536827113dc3707c55f15FC8915"); // ← Komisyon alacak adres
        console.log(`FEE_RECEIVER_ADDRESS: ${FEE_RECEIVER_ADDRESS}`);
        // Factory kontratına bağlan
        const factory = await ethers.getContractAt("UniswapV2Factory", FACTORY_ADDRESS);

        // Mevcut durumu kontrol et
        const currentFeeTo = await factory.feeTo();
        const feeToSetter = await factory.feeToSetter();
        const nullAddress = "0x0000000000000000000000000000000000000000";

        console.log("=== MEVCUT DURUM ===");
        console.log(`Factory Adresi: ${FACTORY_ADDRESS}`);
        console.log(`Mevcut feeTo: ${currentFeeTo}`);
        console.log(`feeToSetter: ${feeToSetter}`);
        console.log(`İşlem türü: ${ACTION}`);

        // Yetki kontrolü
        if (account.address.toLowerCase() !== feeToSetter.toLowerCase()) {
            console.log("❌ HATA: Bu cüzdan feeToSetter değil!");
            console.log(`Sadece ${feeToSetter} adresi bu işlemi yapabilir`);
            return;
        }

        console.log("✅ Yetki kontrolü başarılı");

        // İşlem tipine göre hareket et
        switch (ACTION.toLowerCase()) {
            case 'enable':
                console.log("\n=== PROTOKOL KOMİSYONUNU AÇIYOR ===");
                console.log(`Hedef adres: ${FEE_RECEIVER_ADDRESS}`);
                console.log(`Adres kontrolü: ${ethers.utils.isAddress(FEE_RECEIVER_ADDRESS)}`);

                if (currentFeeTo.toLowerCase() === FEE_RECEIVER_ADDRESS.toLowerCase()) {
                    console.log("⚠️  Protokol komisyonu zaten bu adrese ayarlı!");
                    return;
                }

                try {
                    // Gas estimate yapalım
                    const gasEstimate = await factory.estimateGas.setFeeTo(FEE_RECEIVER_ADDRESS);
                    console.log(`Gas estimate: ${gasEstimate.toString()}`);

                    const enableTx = await factory.setFeeTo(FEE_RECEIVER_ADDRESS, {
                        gasLimit: gasEstimate.mul(2)  // Estimate'in 2 katı
                    });
                    console.log(`Transaction gönderildi: ${enableTx.hash}`);
                    console.log(`⏳ Confirmation bekleniyor...`);

                    const receipt = await enableTx.wait();
                    console.log(`🟢 Protokol komisyonu AÇILDI`);
                    console.log(`💰 Komisyon alıcı: ${FEE_RECEIVER_ADDRESS}`);
                    console.log(`📋 Transaction hash: ${enableTx.hash}`);
                    console.log(`⛽ Gas kullanımı: ${receipt.gasUsed.toString()}`);
                } catch (txError) {
                    console.log(`❌ Transaction hatası: ${txError.message}`);
                    if (txError.reason) {
                        console.log(`❌ Revert reason: ${txError.reason}`);
                    }
                }
                break;

            case 'disable':
                console.log("\n=== PROTOKOL KOMİSYONUNU KAPATIYOR ===");

                const disableTx = await factory.setFeeTo(nullAddress, {
                    gasLimit: 500000  // Gas limit'i artırdık
                });
                await disableTx.wait();

                console.log("🔴 Protokol komisyonu KAPATILDI");
                console.log("💡 Artık tüm komisyon likidite sağlayıcılarına gidecek");
                console.log(`📋 Transaction hash: ${disableTx.hash}`);
                break;

            case 'check':
                console.log("\n=== SADECE KONTROL MODU ===");
                if (currentFeeTo === nullAddress) {
                    console.log("🔴 Protokol komisyonu şu anda KAPALI");
                    console.log("💡 Açmak için ACTION = 'enable' yapın");
                } else {
                    console.log("🟢 Protokol komisyonu şu anda AÇIK");
                    console.log(`💰 Komisyon alıcı: ${currentFeeTo}`);
                    console.log("💡 Kapatmak için ACTION = 'disable' yapın");
                }
                break;

            default:
                console.log("❌ Geçersiz ACTION. 'enable', 'disable', veya 'check' kullanın");
        }

        // Final durum
        const finalFeeTo = await factory.feeTo();
        console.log("\n=== FİNAL DURUM ===");
        console.log(`feeTo adresi: ${finalFeeTo}`);
        console.log(`Durum: ${finalFeeTo === nullAddress ? '🔴 KAPALI' : '🟢 AÇIK'}`);

    } catch (error) {
        console.error("❌ Hata oluştu:", error.message);
        console.log("\n💡 Olası nedenler:");
        console.log("1. FACTORY_ADDRESS yanlış");
        console.log("2. Yeterli gas yok");
        console.log("3. Bu cüzdan feeToSetter değil");
        console.log("4. Network bağlantı problemi");
    }
}

// Ana fonksiyonu çalıştır
manageFee()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

/*
KULLANIM:

1. FACTORY_ADDRESS'i güncelleyin
2. ACTION'ı ayarlayın:
   - "check"   → Sadece mevcut durumu göster
   - "enable"  → Protokol komisyonunu aç (FEE_RECEIVER_ADDRESS gerekli)
   - "disable" → Protokol komisyonunu kapat

3. Çalıştırın:
   npx hardhat run scripts/manage-fee.js --network somnia
*/ 