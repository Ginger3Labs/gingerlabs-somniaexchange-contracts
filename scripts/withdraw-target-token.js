// withdraw.js

// Gerekli kütüphaneyi içe aktar
const { ethers } = require("ethers");

// Gerekli ABI dosyalarını içe aktar. Bu dosyaların yollarını kendi projenize göre güncelleyin.
const RouterABI = require('./dashboard-lp/src/abis/SomniaExchangeRouter.json');
const PairABI = require('./dashboard-lp/src/abis/SomniaExchangePair.json');
const ERC20ABI = require('./dashboard-lp/src/abis/IERC20.json');

// --- KULLANICI AYARLARI ---
// Bu bölümü kendi bilgilerinizle doldurun.
const config = {
    // Ağ Bilgileri
    RPC_URL: "https://rpc.somnia.network", // Kullanmak istediğiniz RPC adresi
    PRIVATE_KEY: "0x...", // İşlemleri imzalayacak cüzdanın özel anahtarı (private key)

    // Akıllı Kontrat Adresleri
    ROUTER_ADDRESS: "0x...", // Somnia Exchange Router adresi

    // Çekim Parametreleri
    pairAddress: "0x...", // Likiditenin çekileceği havuz (pair) adresi
    token0Address: "0x...", // Havuzdaki birinci token'ın adresi
    token1Address: "0x...", // Havuzdaki ikinci token'ın adresi
    percentage: 100, // Çekmek istediğiniz likidite yüzdesi (1-100 arası)
    targetTokenAddress: "0x..." // Çekilen token'ların dönüştürüleceği hedef token adresi
};
// --- KULLANICI AYARLARI SONU ---


async function main() {
    console.log("İşlem başlatılıyor...");

    // 1. Adım: Gerekli Ethers.js nesnelerini oluştur
    const provider = new ethers.JsonRpcProvider(config.RPC_URL);
    const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
    const routerContract = new ethers.Contract(config.ROUTER_ADDRESS, RouterABI.abi, wallet);
    const pairContract = new ethers.Contract(config.pairAddress, PairABI.abi, wallet);
    const token0Contract = new ethers.Contract(config.token0Address, ERC20ABI.abi, provider);
    const token1Contract = new ethers.Contract(config.token1Address, ERC20ABI.abi, provider);

    console.log(`Cüzdan Adresi: ${wallet.address}`);

    try {
        // 2. Adım: LP token bakiyesini ve on-chain verileri çek
        const totalLpBalance = await pairContract.balanceOf(wallet.address);
        if (totalLpBalance === 0n) {
            throw new Error('Çekilecek LP token bulunamadı.');
        }

        const [token0Decimals, token1Decimals] = await Promise.all([
            token0Contract.decimals(),
            token1Contract.decimals()
        ]);

        const amountToWithdraw = (totalLpBalance * BigInt(Math.floor(config.percentage))) / 100n;
        console.log(`Toplam LP Bakiye: ${ethers.formatUnits(totalLpBalance, 18)}`);
        console.log(`Çekilecek Miktar (%${config.percentage}): ${ethers.formatUnits(amountToWithdraw, 18)}`);

        // 3. Adım: Router'a harcama onayı (approve) ver
        const allowance = await pairContract.allowance(wallet.address, config.ROUTER_ADDRESS);
        if (allowance < amountToWithdraw) {
            console.log('Router için LP token harcama onayı veriliyor...');
            const approveTx = await pairContract.approve(config.ROUTER_ADDRESS, ethers.MaxUint256);
            await approveTx.wait();
            console.log('Onay başarılı. Tx Hash:', approveTx.hash);
        } else {
            console.log('Yeterli harcama onayı zaten mevcut.');
        }

        // 4. Adım: Likiditeyi Çek
        console.log('Likidite çekiliyor...');
        const token0WalletBalanceBefore = await token0Contract.balanceOf(wallet.address);
        const token1WalletBalanceBefore = await token1Contract.balanceOf(wallet.address);

        const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 dakika
        const removeTx = await routerContract.removeLiquidity(
            config.token0Address, config.token1Address, amountToWithdraw, 0, 0, wallet.address, deadline
        );
        await removeTx.wait();
        console.log('Likidite başarıyla çekildi. Tx Hash:', removeTx.hash);

        const token0WalletBalanceAfter = await token0Contract.balanceOf(wallet.address);
        const token1WalletBalanceAfter = await token1Contract.balanceOf(wallet.address);

        const receivedToken0Amount = token0WalletBalanceAfter - token0WalletBalanceBefore;
        const receivedToken1Amount = token1WalletBalanceAfter - token1WalletBalanceBefore;
        console.log(`Alınan Token0 Miktarı: ${ethers.formatUnits(receivedToken0Amount, token0Decimals)}`);
        console.log(`Alınan Token1 Miktarı: ${ethers.formatUnits(receivedToken1Amount, token1Decimals)}`);

        // 5. Adım: Alınan Tokenları Hedef Token'a Çevir
        const swapResults = [];
        let totalTargetTokenReceived = 0n;
        const targetTokenContract = new ethers.Contract(config.targetTokenAddress, ERC20ABI.abi, provider);
        const targetTokenDecimals = await targetTokenContract.decimals();


        const swapTokenToTarget = async (tokenAddress, amount, decimals) => {
            if (amount === 0n) return;

            if (tokenAddress.toLowerCase() === config.targetTokenAddress.toLowerCase()) {
                console.log(`${ethers.formatUnits(amount, decimals)} adet hedef token zaten cüzdanda, takas atlanıyor.`);
                totalTargetTokenReceived += amount;
                swapResults.push({ token: tokenAddress, skipped: true, amount: ethers.formatUnits(amount, decimals) });
                return;
            }

            console.log(`${ethers.formatUnits(amount, decimals)} adet ${tokenAddress} token'ı ${config.targetTokenAddress} token'ına çevriliyor...`);

            const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI.abi, wallet);

            const approveSwapTx = await tokenContract.approve(config.ROUTER_ADDRESS, amount);
            await approveSwapTx.wait();
            console.log(`${tokenAddress} için takas onayı verildi. Tx Hash: ${approveSwapTx.hash}`);

            const path = [tokenAddress, config.targetTokenAddress];

            const amountsOut = await routerContract.getAmountsOut(amount, path);
            const expectedAmountOut = amountsOut[amountsOut.length - 1];

            const swapTx = await routerContract.swapExactTokensForTokens(
                amount, 0, path, wallet.address, deadline
            );
            await swapTx.wait();
            console.log(`Takas başarılı. Tx Hash: ${swapTx.hash}`);

            totalTargetTokenReceived += expectedAmountOut;
            swapResults.push({
                token: tokenAddress,
                txHash: swapTx.hash,
                path: path.join(' -> '),
                amountIn: ethers.formatUnits(amount, decimals),
                amountOut: ethers.formatUnits(expectedAmountOut, targetTokenDecimals),
            });
        };

        if (receivedToken0Amount > 0n) {
            await swapTokenToTarget(config.token0Address, receivedToken0Amount, token0Decimals);
        }
        if (receivedToken1Amount > 0n) {
            await swapTokenToTarget(config.token1Address, receivedToken1Amount, token1Decimals);
        }

        // 6. Adım: Sonuçları Göster
        console.log("\n--- İŞLEM TAMAMLANDI ---");
        console.log(`Likidite Çekme TX Hash: ${removeTx.hash}`);
        console.log("Takas Detayları:", JSON.stringify(swapResults, null, 2));
        console.log(`Toplam Alınan Hedef Token Miktarı: ${ethers.formatUnits(totalTargetTokenReceived, targetTokenDecimals)}`);

    } catch (error) {
        console.error('\nİşlem sırasında bir hata oluştu:', error.message);
    }
}

// Betiği çalıştır
main();
