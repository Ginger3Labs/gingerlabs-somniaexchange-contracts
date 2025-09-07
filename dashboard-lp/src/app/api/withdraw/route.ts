import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { clientPromise } from '@/lib/mongodb';
import RouterABI from '@/abis/SomniaExchangeRouter.json';
import PairABI from '@/abis/SomniaExchangePair.json';
import ERC20ABI from '@/abis/IERC20.json';
import { getBestAmountOut } from '@/lib/pathfinder';
import { decrypt } from '@/lib/session';
import { rateLimiter } from '@/lib/rate-limiter';

// Gerekli ortam değişkenlerini kontrol et
if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY ortam değişkeni tanımlanmamış.');
if (!process.env.NEXT_PUBLIC_RPC_URL) throw new Error('NEXT_PUBLIC_RPC_URL ortam değişkeni tanımlanmamış.');
if (!process.env.ROUTER_ADDRESS) throw new Error('ROUTER_ADDRESS ortam değişkeni tanımlanmamış.');
if (!process.env.MONGODB_DB_NAME) throw new Error('MONGODB_DB_NAME ortam değişkeni tanımlanmamış.');
if (!process.env.NEXT_PUBLIC_FACTORY_ADDRESS) throw new Error('NEXT_PUBLIC_FACTORY_ADDRESS ortam değişkeni tanımlanmamış.');


const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS!;
const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS!;

export async function POST(request: NextRequest) {
    try {
        await rateLimiter.checkWithdraw(request);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
        return NextResponse.json({ success: false, message: 'Too many withdraw attempts. Please try again later.' }, { status: 429 });
    }

    const cookie = request.cookies.get('session')?.value;
    const session = await decrypt(cookie);
    if (!session) {
        return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { pairAddress, token0Address, token1Address, percentage, totalValueUSD, targetTokenAddress } = await request.json();

    if (!pairAddress || !token0Address || !token1Address || !percentage || totalValueUSD === undefined || !targetTokenAddress) {
        return NextResponse.json({ success: false, message: 'Eksik parametreler: pairAddress, token0Address, token1Address, percentage, totalValueUSD ve targetTokenAddress gereklidir.' }, { status: 400 });
    }

    if (typeof percentage !== 'number' || percentage <= 0 || percentage > 100) {
        return NextResponse.json({ success: false, message: 'Geçersiz yüzde değeri. 1 ile 100 arasında bir sayı olmalıdır.' }, { status: 400 });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const routerContract = new ethers.Contract(ROUTER_ADDRESS, RouterABI.abi, wallet);
    const pairContract = new ethers.Contract(pairAddress, PairABI.abi, wallet);
    const token0Contract = new ethers.Contract(token0Address, ERC20ABI.abi, provider);
    const token1Contract = new ethers.Contract(token1Address, ERC20ABI.abi, provider);

    try {
        // Gerekli on-chain verileri çek
        const totalLpBalance = await pairContract.balanceOf(wallet.address);
        if (totalLpBalance === 0n) {
            return NextResponse.json({ success: false, message: 'Çekilecek LP token bulunamadı.' }, { status: 400 });
        }

        const [totalSupply, token0Decimals, token1Decimals] = await Promise.all([
            pairContract.totalSupply(),
            token0Contract.decimals(),
            token1Contract.decimals()
        ]);

        const amountToWithdraw = (totalLpBalance * BigInt(Math.floor(percentage))) / 100n;
        console.log(`Toplam Bakiye: ${ethers.formatUnits(totalLpBalance, 18)}, Çekilecek Miktar (%${percentage}): ${ethers.formatUnits(amountToWithdraw, 18)}`);

        const poolShareBefore = (Number(totalLpBalance) / Number(totalSupply)) * 100;

        // Router'a harcama onayı (approve) ver
        const allowance = await pairContract.allowance(wallet.address, ROUTER_ADDRESS);
        if (allowance < amountToWithdraw) {
            console.log('Onay veriliyor...');
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

        // --- ADIM 5: Alınan Tokenları Hedef Token'a Çevir ---
        const swapResults = [];
        let totalTargetTokenReceived = 0n;

        const swapTokenToTarget = async (tokenAddress: string, amount: bigint) => {
            if (amount === 0n) return null;
            if (tokenAddress.toLowerCase() === targetTokenAddress.toLowerCase()) {
                totalTargetTokenReceived += amount;
                return { skipped: true, amount: ethers.formatUnits(amount, 18) };
            }

            const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI.abi, wallet);
            const targetTokenContract = new ethers.Contract(targetTokenAddress, ERC20ABI.abi, provider);
            const targetTokenDecimals = await targetTokenContract.decimals();


            console.log(`[Anlık Mod] ${tokenAddress} için en hızlı ${targetTokenAddress} rotası aranıyor...`);
            const { amount: bestAmountOut, path: bestPath } = await getBestAmountOut(
                tokenAddress,
                targetTokenAddress,
                amount,
                ROUTER_ADDRESS,
                FACTORY_ADDRESS,
                provider
            );

            if (bestAmountOut === 0n || bestPath.length === 0) {
                console.log(`${tokenAddress} için ${targetTokenAddress}'e giden bir rota bulunamadı.`);
                return { error: "Rota bulunamadı", amountIn: ethers.formatUnits(amount, await tokenContract.decimals()) };
            }

            console.log(`Kullanılacak rota: ${bestPath.join(' -> ')} | Beklenen Hedef Token: ${ethers.formatUnits(bestAmountOut, targetTokenDecimals)}`);

            // Onay ve Swap
            const approveTx = await tokenContract.approve(ROUTER_ADDRESS, amount);
            await approveTx.wait();

            const swapTx = await routerContract.swapExactTokensForTokens(
                amount, 0, bestPath, wallet.address, Math.floor(Date.now() / 1000) + 60 * 20
            );
            await swapTx.wait();

            totalTargetTokenReceived += bestAmountOut;

            return {
                txHash: swapTx.hash,
                path: bestPath.join(' -> '),
                amountIn: ethers.formatUnits(amount, await tokenContract.decimals()),
                amountOut: ethers.formatUnits(bestAmountOut, await targetTokenContract.decimals()),
            };
        };

        if (receivedToken0Amount > 0n) {
            const result = await swapTokenToTarget(token0Address, receivedToken0Amount);
            swapResults.push({ token: token0Address, ...result });
        }
        if (receivedToken1Amount > 0n) {
            const result = await swapTokenToTarget(token1Address, receivedToken1Amount);
            swapResults.push({ token: token1Address, ...result });
        }

        // --- ADIM 6: Loglama ve Yanıt ---
        const newLpBalance = await pairContract.balanceOf(wallet.address);
        const newTotalSupply = await pairContract.totalSupply();

        try {
            const poolShareAfter = newTotalSupply > 0n ? (Number(newLpBalance) / Number(newTotalSupply)) * 100 : 0;
            const valueAfterUSD = totalValueUSD > 0 && totalLpBalance > 0n ? totalValueUSD * (Number(newLpBalance) / Number(totalLpBalance)) : 0;

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
                    finalTargetTokenReceived: ethers.formatUnits(totalTargetTokenReceived, await (new ethers.Contract(targetTokenAddress, ERC20ABI.abi, provider)).decimals())
                }
            };
            await collection.insertOne(logEntry);
            console.log('İşlem logu veritabanına kaydedildi.');
        } catch (dbError) {
            console.error('Veritabanına yazma hatası:', dbError);
        }

        const targetTokenContract = new ethers.Contract(targetTokenAddress, ERC20ABI.abi, provider);
        const targetTokenDecimals = await targetTokenContract.decimals();

        return NextResponse.json({
            success: true,
            removeLiquidityTxHash: removeTx.hash,
            swaps: swapResults,
            totalTargetTokenReceived: ethers.formatUnits(totalTargetTokenReceived, targetTokenDecimals)
        });

    } catch (error: unknown) {
        console.error('İşlem sırasında hata oluştu:', error);
        // Kullanıcıya genel bir hata mesajı göster.
        // Gerçek hata sunucu loglarında (yukarıdaki console.error) görülebilir.
        const message = 'An internal server error occurred during the withdrawal process.';
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
