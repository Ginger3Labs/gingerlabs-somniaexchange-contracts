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

    // --- Aşama 1: Öncelikli Token'lar ile En İyi Rotayı Ara ---
    const priorityTokensStr = process.env.NEXT_PUBLIC_PRIORITY_TOKENS || '';
    const priorityTokenSet = new Set(priorityTokensStr.split(',').map(t => t.trim().toLowerCase()));
    priorityTokenSet.add(tokenInAddress.toLowerCase());
    priorityTokenSet.add(tokenOutAddress.toLowerCase());

    let bestAmountOut = 0n;
    let bestPath: string[] = [];

    const findPaths = async (isPriorityOnly: boolean) => {
        const queue: string[][] = [[tokenInAddress]];
        const foundPaths: string[][] = [];

        while (queue.length > 0) {
            const path = queue.shift()!;
            const currentToken = path[path.length - 1];

            if (path.length > MAX_HOPS) continue;

            if (currentToken.toLowerCase() === tokenOutAddress.toLowerCase()) {
                foundPaths.push(path);
                continue;
            }

            const neighbors = graph.get(currentToken.toLowerCase()) || [];
            for (const neighbor of neighbors) {
                const nextToken = neighbor.otherToken;
                if (path.map(p => p.toLowerCase()).includes(nextToken.toLowerCase())) continue;

                if (isPriorityOnly && !priorityTokenSet.has(nextToken.toLowerCase())) continue;
                
                const newPath = [...path, nextToken];
                queue.push(newPath);
            }
        }
        return foundPaths;
    };

    // Öncelikli rotaları bul
    const priorityPaths = await findPaths(true);

    if (priorityPaths.length > 0) {
        const amountsOutPromises = priorityPaths.map(path =>
            router.getAmountsOut(amountIn, path).catch(() => null)
        );
        const results = await Promise.all(amountsOutPromises);

        for (let i = 0; i < results.length; i++) {
            if (results[i]) {
                const amount = results[i][results[i].length - 1];
                if (amount > bestAmountOut) {
                    bestAmountOut = amount;
                    bestPath = priorityPaths[i];
                }
            }
        }
    }

    // Eğer öncelikli rotalardan bir sonuç geldiyse, onu döndür.
    if (bestAmountOut > 0n) {
        return { amount: bestAmountOut, path: bestPath };
    }

    // --- Aşama 2: Öncelikli Rota Bulunamazsa, İlk Geçerli Rotayı Hızla Bul ---
    const queue: string[][] = [[tokenInAddress]];
    const visited = new Set<string>([tokenInAddress.toLowerCase()]);

    while (queue.length > 0) {
        const path = queue.shift()!;
        const currentToken = path[path.length - 1];

        if (path.length > MAX_HOPS) continue;

        const neighbors = graph.get(currentToken.toLowerCase()) || [];
        for (const neighbor of neighbors) {
            const nextToken = neighbor.otherToken;
            const nextTokenLower = nextToken.toLowerCase();

            if (visited.has(nextTokenLower)) continue;
            visited.add(nextTokenLower);

            const newPath = [...path, nextToken];

            if (nextTokenLower === tokenOutAddress.toLowerCase()) {
                try {
                    const amountsOut = await router.getAmountsOut(amountIn, newPath);
                    const finalAmount = amountsOut[amountsOut.length - 1];
                    if (finalAmount > 0n) {
                        // İlk geçerli rotayı bulduk, hemen döndür.
                        return { amount: finalAmount, path: newPath };
                    }
                } catch (e) {
                    // Bu yol geçerli değil, devam et.
                }
            }
            queue.push(newPath);
        }
    }

    // Hiçbir rota bulunamadı.
    return { amount: 0n, path: [] };
}