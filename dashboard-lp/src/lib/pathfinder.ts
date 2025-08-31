import { ethers } from 'ethers';
import FactoryABI from '@/abis/SomniaExchangeFactory.json';
import PairABI from '@/abis/SomniaExchangePair.json';
import RouterABI from '@/abis/SomniaExchangeRouter.json';

// Tip tanımlamaları
export type TradingGraph = Map<string, { pairAddress: string, otherToken: string }[]>;

/**
 * Tüm likidite havuzlarını on-chain'den tarayarak bir takas grafiği oluşturur.
 * Bu fonksiyon, sunucu tarafında veya istemci tarafında çalıştırılabilir.
 * @param factoryAddress - Exchange Factory contract adresi
 * @param provider - Ethers Provider instance (JsonRpcProvider vb.)
 * @param onProgress - (Opsiyonel) İlerleme hakkında bilgi vermek için bir callback fonksiyonu. Örn: (message) => console.log(message)
 * @returns TradingGraph
 */
export async function buildTradingGraph(
    factoryAddress: string,
    provider: ethers.Provider,
    onProgress?: (message: string) => void
): Promise<TradingGraph> {
    const factory = new ethers.Contract(factoryAddress, FactoryABI.abi, provider);
    const allPairsData: TradingGraph = new Map();

    try {
        const pairCount = await factory.allPairsLength();
        const pairsToScan = Number(pairCount);
        onProgress?.(`Tüm takas rotalarını analiz etmek için ${pairsToScan} çift taranıyor...`);

        const BATCH_SIZE_GRAPH = 100;
        for (let i = 0; i < pairsToScan; i += BATCH_SIZE_GRAPH) {
            const batchEnd = Math.min(i + BATCH_SIZE_GRAPH, pairsToScan);
            onProgress?.(`Rota analizi: ${i + 1}-${batchEnd}/${pairsToScan}`);

            const pairAddressPromises = Array.from({ length: batchEnd - i }, (_, k) => factory.allPairs(i + k).catch(() => null));
            const pairAddresses = (await Promise.all(pairAddressPromises)).filter((addr): addr is string => !!addr);

            const tokenPromises = pairAddresses.map(addr => {
                const pairContract = new ethers.Contract(addr, PairABI.abi, provider);
                return Promise.all([pairContract.token0(), pairContract.token1()])
                    .then(([token0, token1]) => ({ pairAddress: addr, token0, token1 }))
                    .catch(() => null);
            });

            const tokensData = (await Promise.all(tokenPromises)).filter((d): d is { pairAddress: string, token0: string, token1: string } => !!d);

            for (const { pairAddress, token0, token1 } of tokensData) {
                const t0 = token0.toLowerCase();
                const t1 = token1.toLowerCase();
                allPairsData.set(t0, [...(allPairsData.get(t0) || []), { pairAddress, otherToken: token1 }]);
                allPairsData.set(t1, [...(allPairsData.get(t1) || []), { pairAddress, otherToken: token0 }]);
            }
        }
        onProgress?.('Takas grafiği başarıyla oluşturuldu.');
        return allPairsData;
    } catch (e) {
        console.error("Rota grafiği oluşturulurken hata:", e);
        onProgress?.("Rota analizi başarısız oldu.");
        throw e; // Hatanın yukarıya bildirilmesi için throw ediyoruz.
    }
}

/**
 * Verilen bir takas grafiği üzerinde en iyi takas yolunu ve miktarını bulur (BFS).
 * @param tokenInAddress - Başlangıç token adresi
 * @param tokenOutAddress - Hedef token adresi
 * @param amountIn - Başlangıç token miktarı
 * @param graph - buildTradingGraph tarafından oluşturulan takas grafiği
 * @param routerAddress - Exchange Router contract adresi
 * @param provider - Ethers Provider instance
 * @returns En iyi takas sonucu { amount: bigint, path: string[] }
 */
export async function getBestAmountOut(
    tokenInAddress: string,
    tokenOutAddress: string,
    amountIn: bigint,
    graph: TradingGraph,
    routerAddress: string,
    provider: ethers.Provider
): Promise<{ amount: bigint, path: string[] }> {
    if (tokenInAddress.toLowerCase() === tokenOutAddress.toLowerCase()) {
        return { amount: amountIn, path: [tokenInAddress] };
    }

    const router = new ethers.Contract(routerAddress, RouterABI.abi, provider);
    const MAX_HOPS = 4;
    let bestAmountOut = 0n;
    let bestPath: string[] = [];

    const queue: { path: string[], currentAmount: bigint }[] = [{ path: [tokenInAddress], currentAmount: amountIn }];
    const visitedRoutes = new Set<string>(); // Ziyaret edilen rotaları (token çiftlerini) takip etmek için

    while (queue.length > 0) {
        const { path, currentAmount } = queue.shift()!;
        const currentToken = path[path.length - 1];

        if (path.length - 1 >= MAX_HOPS) {
            continue;
        }

        const neighbors = graph.get(currentToken.toLowerCase()) || [];

        for (const neighbor of neighbors) {
            const nextToken = neighbor.otherToken;

            // Döngüleri önlemek için bir sonraki token'ın yolda olup olmadığını kontrol et
            if (path.map(p => p.toLowerCase()).includes(nextToken.toLowerCase())) {
                continue;
            }

            const newPath = [...path, nextToken];

            try {
                const amountsOut = await router.getAmountsOut(currentAmount, [currentToken, nextToken]);
                const nextAmount = amountsOut[1];

                if (nextToken.toLowerCase() === tokenOutAddress.toLowerCase()) {
                    if (nextAmount > bestAmountOut) {
                        bestAmountOut = nextAmount;
                        bestPath = newPath;
                    }
                } else {
                    queue.push({ path: newPath, currentAmount: nextAmount });
                }
            } catch (e) {
                // Bu rota geçerli değilse (likidite yok vb.), görmezden gel ve devam et.
            }
        }
    }

    return { amount: bestAmountOut, path: bestPath };
}