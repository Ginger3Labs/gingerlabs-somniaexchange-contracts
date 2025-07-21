const { ethers } = require('hardhat');

async function checkFeeStatus() {
    try {
        [account] = await ethers.getSigners();
        console.log(`Kontrol eden adres: ${account.address}`);

        // Factory kontrat adresini buraya girin (deploy-uniswap.js'den aldığınız adres)
        // Bu adresi deploy scriptinizden alın
        const FACTORY_ADDRESS = "0x31015A978c5815EdE29D0F969a17e116BC1866B1".toLowerCase(); // ← Bu adresi güncelleyin!

        // Factory kontratına bağlan
        const factory = await ethers.getContractAt("SomniaExchangeFactory", FACTORY_ADDRESS);

        // feeTo adresini al
        const feeToAddress = await factory.feeTo();

        // feeToSetter adresini al (kim değiştirebilir)
        const feeToSetterAddress = await factory.feeToSetter();

        console.log("=== PROTOKOL KOMİSYON DURUMU ===");
        console.log(`Factory Kontrat Adresi: ${FACTORY_ADDRESS}`);
        console.log(`feeTo Adresi: ${feeToAddress}`);
        console.log(`feeToSetter Adresi: ${feeToSetterAddress}`);

        // Null address kontrolü
        const nullAddress = "0x0000000000000000000000000000000000000000";

        if (feeToAddress === nullAddress) {
            console.log("🔴 PROTOKOL KOMİSYONU: KAPALI");
            console.log("   → Protokol komisyonu toplanmıyor");
            console.log("   → Tüm swap komisyonu likidite sağlayıcılarına gidiyor");
        } else {
            console.log("🟢 PROTOKOL KOMİSYONU: AÇIK");
            console.log(`   → Komisyon alıcı adres: ${feeToAddress}`);
            console.log("   → Likidite büyümesinin 1/6'sı protokole gidiyor");
        }

        console.log("\n=== SWAP KOMİSYON BİLGİSİ ===");
        console.log("🔹 Swap komisyonu: %0.3 (sabit)");
        console.log("🔹 Bu oran kontrat kodunda hardcoded");
        console.log("🔹 Runtime'da değiştirilemez");

        // Eğer mevcut kullanıcı feeToSetter ise kontrol seçenekleri göster
        if (account.address.toLowerCase() === feeToSetterAddress.toLowerCase()) {
            console.log("\n=== KONTROL YETKİLERİNİZ ===");
            console.log("✅ Bu cüzdanla protokol komisyonunu açabilir/kapatabilirsiniz");
            console.log("✅ feeToSetter yetkisini başkasına devredebilirsiniz");
        } else {
            console.log("\n=== KONTROL YETKİLERİ ===");
            console.log("❌ Bu cüzdan protokol komisyonunu değiştiremez");
            console.log(`❌ Sadece ${feeToSetterAddress} adresi değiştirebilir`);
        }

    } catch (error) {
        console.error("❌ Hata oluştu:", error.message);
        console.log("\n💡 Olası çözümler:");
        console.log("1. FACTORY_ADDRESS'i doğru kontrat adresiyle güncelleyin");
        console.log("2. Ağ bağlantınızı kontrol edin");
        console.log("3. Kontrat deploy edildiğinden emin olun");
    }
}

// Ana fonksiyonu çalıştır
checkFeeStatus()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

// Kullanım:
// npx hardhat run scripts/check-fee-status.js --network somnia 