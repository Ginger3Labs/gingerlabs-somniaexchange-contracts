import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import clientPromise from '@/lib/mongodb';
import RouterABI from '@/abis/SomniaExchangeRouter.json';
import PairABI from '@/abis/SomniaExchangePair.json';
import ERC20ABI from '@/abis/IERC20.json';

// Gerekli ortam değişkenlerini kontrol et
if (!process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY ortam değişkeni tanımlanmamış.');
}
if (!process.env.NEXT_PUBLIC_RPC_URL) {
    throw new Error('NEXT_PUBLIC_RPC_URL ortam değişkeni tanımlanmamış.');
}
if (!process.env.ROUTER_ADDRESS) {
    throw new Error('ROUTER_ADDRESS ortam değişkeni tanımlanmamış.');
}
if (!process.env.MONGODB_DB_NAME) {
    throw new Error('MONGODB_DB_NAME ortam değişkeni tanımlanmamış.');
}


const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS!;
// Swap işlemleri için sabit adresler (.env'den okunur)
const WSTT_ADDRESS = process.env.NEXT_PUBLIC_WSTT_ADDRESS!;
const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS!;


export async function POST(request: Request) {
    const { pairAddress, token0Address, token1Address, percentage, totalValueUSD } = await request.json();

    if (!pairAddress || !token0Address || !token1Address || !percentage || totalValueUSD === undefined) {
        return NextResponse.json({ success: false, message: 'Eksik parametreler: pairAddress, token0Address, token1Address, percentage ve totalValueUSD gereklidir.' }, { status: 400 });
    }

    if (typeof percentage !== 'number' || percentage <= 0 || percentage > 100) {
        return NextResponse.json({ success: false, message: 'Geçersiz yüzde değeri. 1 ile 100 arasında bir sayı olmalıdır.' }, { status: 400 });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const routerContract = new ethers.Contract(ROUTER_ADDRESS, (RouterABI as any).abi, wallet);
    // PairABI'yi kullanarak daha fazla fonksiyona erişim sağlıyoruz (getReserves, totalSupply)
    const pairContract = new ethers.Contract(pairAddress, PairABI.abi, wallet);
    const token0Contract = new ethers.Contract(token0Address, ERC20ABI.abi, provider);
    const token1Contract = new ethers.Contract(token1Address, ERC20ABI.abi, provider);

    try {
        // Gerekli on-chain verileri çek
        const totalLpBalance = await pairContract.balanceOf(wallet.address);
        if (totalLpBalance === 0n) {
            return NextResponse.json({ success: false, message: 'Çekilecek LP token bulunamadı.' }, { status: 400 });
        }

        const [reserves, totalSupply, token0Decimals, token1Decimals] = await Promise.all([
            pairContract.getReserves(),
            pairContract.totalSupply(),
            token0Contract.decimals(),
            token1Contract.decimals()
        ]);
        // getReserves'den dönen değer bir array'dir. Doğru şekilde alalım.
        const _reserve0: bigint = reserves[0];
        const _reserve1: bigint = reserves[1];

        // --- İşlem Öncesi Hesaplamalar (Tümü BigInt ile) ---
        const userToken0BalanceBefore: bigint = (_reserve0 * totalLpBalance) / totalSupply;
        const userToken1BalanceBefore: bigint = (_reserve1 * totalLpBalance) / totalSupply;

        // Yüzdeye göre çekilecek miktarı hesapla
        const amountToWithdraw = (totalLpBalance * BigInt(Math.floor(percentage))) / 100n;
        console.log(`Toplam Bakiye: ${ethers.formatUnits(totalLpBalance, 18)}, Çekilecek Miktar (%${percentage}): ${ethers.formatUnits(amountToWithdraw, 18)}`);

        // Çekilecek token miktarlarını hesapla (Tümü BigInt ile)
        // Hassasiyet kaybını önlemek için önce çarpma
        const withdrawnToken0: bigint = (userToken0BalanceBefore * amountToWithdraw) / totalLpBalance;
        const withdrawnToken1: bigint = (userToken1BalanceBefore * amountToWithdraw) / totalLpBalance;

        // Yüzde hesaplamalarını Number'a çevirerek en son yap
        const poolShareBefore = (Number(totalLpBalance) / Number(totalSupply)) * 100;

        // Router'a harcama onayı (approve) ver
        const allowance = await pairContract.allowance(wallet.address, ROUTER_ADDRESS);
        if (allowance < amountToWithdraw) {
            console.log('Onay veriliyor...');
            // Sadece gereken miktar için onay vermek yerine, gelecekteki işlemler için MaxUint256 kullanmak daha verimli olabilir.
            const approveTx = await pairContract.approve(ROUTER_ADDRESS, ethers.MaxUint256);
            await approveTx.wait();
            console.log('Onay başarılı:', approveTx.hash);
        } else {
            console.log('Yeterli onay zaten mevcut.');
        }

        // --- ADIM 4: Likiditeyi Çek ---
        console.log('Likidite çekiliyor...');
        const token0WalletBalanceBefore = BigInt(await (new ethers.Contract(token0Address, ERC20ABI.abi, wallet)).balanceOf(wallet.address));
        const token1WalletBalanceBefore = BigInt(await (new ethers.Contract(token1Address, ERC20ABI.abi, wallet)).balanceOf(wallet.address));

        const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 dakika
        const removeTx = await routerContract.removeLiquidity(
            token0Address, token1Address, amountToWithdraw, 0, 0, wallet.address, deadline
        );
        const receipt = await removeTx.wait();
        console.log('Likidite başarıyla çekildi:', removeTx.hash);

        const token0WalletBalanceAfter = BigInt(await (new ethers.Contract(token0Address, ERC20ABI.abi, wallet)).balanceOf(wallet.address));
        const token1WalletBalanceAfter = BigInt(await (new ethers.Contract(token1Address, ERC20ABI.abi, wallet)).balanceOf(wallet.address));

        const receivedToken0Amount: bigint = token0WalletBalanceAfter - token0WalletBalanceBefore;
        const receivedToken1Amount: bigint = token1WalletBalanceAfter - token1WalletBalanceBefore;
        console.log(`Alınan Token0 Miktarı: ${ethers.formatUnits(receivedToken0Amount, token0Decimals)}`);
        console.log(`Alınan Token1 Miktarı: ${ethers.formatUnits(receivedToken1Amount, token1Decimals)}`);

        // --- ADIM 5: Alınan Tokenları WSTT'ye Çevir ---
        const swapResults = [];
        let totalWSTTReceived = 0n;

        const swapTokenToWSTT = async (tokenAddress: string, amount: bigint) => {
            if (amount === 0n) return null;
            if (tokenAddress.toLowerCase() === WSTT_ADDRESS.toLowerCase()) {
                totalWSTTReceived += amount;
                return { skipped: true, amount: ethers.formatUnits(amount, 18) };
            }

            console.log(`${tokenAddress} WSTT'ye çevriliyor...`);
            const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI.abi, wallet);

            // En iyi rotayı bul
            const directPath = [tokenAddress, WSTT_ADDRESS];
            const usdcPath = [tokenAddress, USDC_ADDRESS, WSTT_ADDRESS];
            let bestPath = directPath;
            let bestAmountOut = 0n;

            try {
                const directAmountsOut = await routerContract.getAmountsOut(amount, directPath);
                bestAmountOut = directAmountsOut[directAmountsOut.length - 1];
            } catch (e) { /* Rota yoksa devam et */ }

            try {
                const usdcAmountsOut = await routerContract.getAmountsOut(amount, usdcPath);
                const usdcAmountOut = usdcAmountsOut[usdcAmountsOut.length - 1];
                if (usdcAmountOut > bestAmountOut) {
                    bestAmountOut = usdcAmountOut;
                    bestPath = usdcPath;
                }
            } catch (e) { /* Rota yoksa devam et */ }

            if (bestAmountOut === 0n) {
                console.log(`${tokenAddress} için WSTT'ye giden bir rota bulunamadı.`);
                return { error: "Rota bulunamadı" };
            }
            console.log(`En iyi rota: ${bestPath.join(' -> ')} | Beklenen WSTT: ${ethers.formatUnits(bestAmountOut, 18)}`);

            // Onay ve Swap
            const approveTx = await tokenContract.approve(ROUTER_ADDRESS, amount);
            await approveTx.wait();
            const swapTx = await routerContract.swapExactTokensForTokens(
                amount, 0, bestPath, wallet.address, Math.floor(Date.now() / 1000) + 60 * 20
            );
            const swapReceipt = await swapTx.wait();
            totalWSTTReceived += bestAmountOut;

            return {
                txHash: swapTx.hash,
                path: bestPath.join(' -> '),
                amountIn: ethers.formatUnits(amount, await tokenContract.decimals()),
                amountOut: ethers.formatUnits(bestAmountOut, 18),
            };
        };

        if (receivedToken0Amount > 0n) {
            const result = await swapTokenToWSTT(token0Address, receivedToken0Amount);
            swapResults.push({ token: token0Address, ...result });
        }
        if (receivedToken1Amount > 0n) {
            const result = await swapTokenToWSTT(token1Address, receivedToken1Amount);
            swapResults.push({ token: token1Address, ...result });
        }

        // --- ADIM 6: Loglama ve Yanıt ---
        const newLpBalance = await pairContract.balanceOf(wallet.address);
        const newTotalSupply = await pairContract.totalSupply();

        try {
            const poolShareAfter = newTotalSupply > 0n ? (Number(newLpBalance) / Number(newTotalSupply)) * 100 : 0;
            // totalLpBalance burada işlem öncesi değeri tutar, bu yüzden bu hesaplama doğrudur.
            const valueAfterUSD = totalValueUSD * (Number(newLpBalance) / Number(totalLpBalance));

            const client = await clientPromise;
            const db = client.db(process.env.MONGODB_DB_NAME);
            const collection = db.collection('withdrawals');
            const logEntry = {
                timestamp: new Date(),
                walletAddress: wallet.address,
                pairAddress,
                removeLiquidityTxHash: removeTx.hash,
                blockNumber: receipt.blockNumber,
                details: {
                    percentage,
                    totalValueUSD: {
                        before: totalValueUSD.toFixed(4),
                        after: valueAfterUSD.toFixed(4),
                    },
                    lp: {
                        balanceBefore: ethers.formatUnits(totalLpBalance, 18),
                        withdrawn: ethers.formatUnits(amountToWithdraw, 18),
                        balanceAfter: ethers.formatUnits(newLpBalance, 18),
                    },
                    poolShare: {
                        before: `${poolShareBefore.toFixed(6)}%`,
                        after: `${poolShareAfter.toFixed(6)}%`,
                    },
                    swaps: swapResults,
                    finalWSTTReceived: ethers.formatUnits(totalWSTTReceived, 18)
                }
            };
            await collection.insertOne(logEntry);
            console.log('İşlem logu veritabanına kaydedildi.');
        } catch (dbError) {
            console.error('Veritabanına yazma hatası:', dbError);
        }

        return NextResponse.json({
            success: true,
            removeLiquidityTxHash: removeTx.hash,
            swaps: swapResults,
            totalWSTTReceived: ethers.formatUnits(totalWSTTReceived, 18)
        });

    } catch (error: any) {
        console.error('İşlem sırasında hata oluştu:', error);
        return NextResponse.json({ success: false, message: error.reason || error.message || 'Bilinmeyen bir hata oluştu.' }, { status: 500 });
    }
}
