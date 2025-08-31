import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
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


const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;

export async function POST(request: Request) {
    const { pairAddress, token0Address, token1Address, percentage } = await request.json();

    if (!pairAddress || !token0Address || !token1Address || !percentage) {
        return NextResponse.json({ success: false, message: 'Eksik parametreler: pairAddress, token0Address, token1Address ve percentage gereklidir.' }, { status: 400 });
    }

    if (typeof percentage !== 'number' || percentage <= 0 || percentage > 100) {
        return NextResponse.json({ success: false, message: 'Geçersiz yüzde değeri. 1 ile 100 arasında bir sayı olmalıdır.' }, { status: 400 });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const routerContract = new ethers.Contract(ROUTER_ADDRESS, (RouterABI as any).abi, wallet);
    const pairContract = new ethers.Contract(pairAddress, ERC20ABI.abi, wallet);

    try {
        // 1. Toplam LP miktarını al
        const totalLpBalance = await pairContract.balanceOf(wallet.address);
        if (totalLpBalance === 0n) {
            return NextResponse.json({ success: false, message: 'Çekilecek LP token bulunamadı.' }, { status: 400 });
        }

        // 2. Yüzdeye göre çekilecek miktarı hesapla
        const amountToWithdraw = (totalLpBalance * BigInt(percentage)) / 100n;
        console.log(`Toplam Bakiye: ${ethers.formatEther(totalLpBalance)}, Çekilecek Miktar (%${percentage}): ${ethers.formatEther(amountToWithdraw)}`);


        // 3. Router'a harcama onayı (approve) ver
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

        await removeTx.wait();
        console.log('Likidite başarıyla çekildi:', removeTx.hash);

        return NextResponse.json({ success: true, txHash: removeTx.hash });

    } catch (error: any) {
        console.error('İşlem sırasında hata oluştu:', error);
        return NextResponse.json({ success: false, message: error.reason || error.message || 'Bilinmeyen bir hata oluştu.' }, { status: 500 });
    }
}