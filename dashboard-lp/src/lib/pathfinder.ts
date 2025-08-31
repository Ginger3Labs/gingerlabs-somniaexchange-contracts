import { ethers } from 'ethers';
import FactoryABI from '@/abis/SomniaExchangeFactory.json';
import RouterABI from '@/abis/SomniaExchangeRouter.json';

// Adreslerin her zaman checksum'li ve küçük harfli olmasını sağlayan yardımcı fonksiyon
const normalizeAddress = (address: string) => ethers.getAddress(address).toLowerCase();

/**
 * Verilen token çiftleri için en hızlı ve geçerli takas yolunu on-chain olarak bulur.
 * Önce doğrudan (A -> B), sonra öncelikli tokenlar üzerinden (A -> P -> B) rotaları arar.
 * @param tokenInAddress - Başlangıç token adresi
 * @param tokenOutAddress - Hedef token adresi
 * @param amountIn - Başlangıç token miktarı
 * @param routerAddress - Exchange Router contract adresi
 * @param factoryAddress - Exchange Factory contract adresi
 * @param provider - Ethers Provider instance
 * @returns En hızlı bulunan takas sonucu { amount: bigint, path: string[] }
 */
export async function getBestAmountOut(
    tokenInAddress: string,
    tokenOutAddress: string,
    amountIn: bigint,
    routerAddress: string,
    factoryAddress: string,
    provider: ethers.Provider
): Promise<{ amount: bigint, path: string[] }> {
    const tIn = normalizeAddress(tokenInAddress);
    const tOut = normalizeAddress(tokenOutAddress);

    if (tIn === tOut) {
        return { amount: amountIn, path: [tokenInAddress] };
    }

    const router = new ethers.Contract(routerAddress, RouterABI.abi, provider);
    const factory = new ethers.Contract(factoryAddress, FactoryABI.abi, provider);
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    // --- Aşama 1: Doğrudan Rotayı Kontrol Et (TokenIn -> TokenOut) ---
    try {
        const directPairAddress = await factory.getPair(tIn, tOut);
        if (directPairAddress && directPairAddress !== ZERO_ADDRESS) {
            const path = [tokenInAddress, tokenOutAddress];
            const amountsOut = await router.getAmountsOut(amountIn, path);
            const finalAmount = amountsOut[amountsOut.length - 1];
            if (finalAmount > 0n) {
                return { amount: finalAmount, path };
            }
        }
    } catch {
        // Bu yol geçerli değil, devam et.
    }

    // --- Aşama 2: Öncelikli Tokenlar Üzerinden Tek Adımlı Rota Ara ---
    const priorityTokensStr = process.env.NEXT_PUBLIC_PRIORITY_TOKENS || '';
    const priorityTokens = priorityTokensStr.split(',').map(t => t.trim()).filter(Boolean);

    for (const pTokenAddress of priorityTokens) {
        try {
            const pToken = normalizeAddress(pTokenAddress);
            if (pToken === tIn || pToken === tOut) continue;

            // Yolu kontrol et: TokenIn -> pToken -> TokenOut
            const pair1 = await factory.getPair(tIn, pToken);
            const pair2 = await factory.getPair(pToken, tOut);

            if (pair1 && pair1 !== ZERO_ADDRESS && pair2 && pair2 !== ZERO_ADDRESS) {
                const path = [tokenInAddress, pTokenAddress, tokenOutAddress];
                const amountsOut = await router.getAmountsOut(amountIn, path);
                const finalAmount = amountsOut[amountsOut.length - 1];
                if (finalAmount > 0n) {
                    // İlk geçerli rotayı bulduk, hemen döndür.
                    return { amount: finalAmount, path };
                }
            }
        } catch {
            // Bu yol geçerli değil, sonraki öncelikli token ile devam et.
        }
    }

    // Hiçbir rota bulunamadı.
    return { amount: 0n, path: [] };
}
