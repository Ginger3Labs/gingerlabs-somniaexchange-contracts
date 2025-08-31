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


const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;

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

        // 4. Likiditeyi çek (removeLiquidity)
        console.log('Likidite çekiliyor...');
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 dakika
        const removeTx = await routerContract.removeLiquidity(
            token0Address,
            token1Address,
            amountToWithdraw, // Hesaplanan miktarı kullan
            0, // amountAMin, slipaj kontrolü için 0 bırakıldı
            0, // amountBMin, slipaj kontrolü için 0 bırakıldı
            wallet.address,
            deadline
        );

        const receipt = await removeTx.wait();
        console.log('Likidite başarıyla çekildi:', removeTx.hash);

        // İşlem sonrası yeni bakiye ve havuz durumu
        const newLpBalance = await pairContract.balanceOf(wallet.address);
        const newTotalSupply = await pairContract.totalSupply(); // Bu işlem sonrası güncellenmiş olacak

        // --- İşlem Sonrası Hesaplamalar ---
        const poolShareAfter = newTotalSupply > 0n ? (Number(newLpBalance) / Number(newTotalSupply)) * 100 : 0;
        const userToken0BalanceAfter = userToken0BalanceBefore - withdrawnToken0;
        const userToken1BalanceAfter = userToken1BalanceBefore - withdrawnToken1;

        // USD Değer Hesaplamaları
        const valueBeforeUSD = totalValueUSD;
        const withdrawnValueUSD = valueBeforeUSD * (percentage / 100);
        const valueAfterUSD = valueBeforeUSD - withdrawnValueUSD;


        // Veritabanına log kaydet
        try {
            const client = await clientPromise;
            const db = client.db(process.env.MONGODB_DB_NAME);
            const collection = db.collection('withdrawals');

            const logEntry = {
                timestamp: new Date(),
                walletAddress: wallet.address,
                pairAddress,
                txHash: removeTx.hash,
                blockNumber: receipt.blockNumber,
                details: {
                    percentage,
                    totalValueUSD: {
                        before: valueBeforeUSD.toFixed(4),
                        withdrawn: withdrawnValueUSD.toFixed(4),
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
                    token0: {
                        address: token0Address,
                        balanceBefore: ethers.formatUnits(userToken0BalanceBefore, token0Decimals),
                        withdrawn: ethers.formatUnits(withdrawnToken0, token0Decimals),
                        balanceAfter: ethers.formatUnits(userToken0BalanceAfter, token0Decimals),
                    },
                    token1: {
                        address: token1Address,
                        balanceBefore: ethers.formatUnits(userToken1BalanceBefore, token1Decimals),
                        withdrawn: ethers.formatUnits(withdrawnToken1, token1Decimals),
                        balanceAfter: ethers.formatUnits(userToken1BalanceAfter, token1Decimals),
                    }
                }
            };

            await collection.insertOne(logEntry);
            console.log('İşlem logu veritabanına kaydedildi.');

        } catch (dbError) {
            console.error('Veritabanına yazma hatası:', dbError);
            // DB hatası ana işlemi etkilememeli, sadece loglanır.
        }

        return NextResponse.json({ success: true, txHash: removeTx.hash });

    } catch (error: any) {
        console.error('İşlem sırasında hata oluştu:', error);
        return NextResponse.json({ success: false, message: error.reason || error.message || 'Bilinmeyen bir hata oluştu.' }, { status: 500 });
    }
}