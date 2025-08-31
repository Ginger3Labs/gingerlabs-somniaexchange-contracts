import { TradingGraph } from './pathfinder';

interface Cache {
    graph: TradingGraph | null;
    timestamp: number;
}

// Sunucu çalıştığı sürece bellekte kalacak olan cache objesi.
// Next.js'in hot-reloading mekanizması nedeniyle geliştirme ortamında
// bu değişkenin sıfırlanmaması için globalThis kullanılır.
const globalWithCache = globalThis as typeof globalThis & {
    _tradingGraphCache?: Cache;
};

if (!globalWithCache._tradingGraphCache) {
    globalWithCache._tradingGraphCache = {
        graph: null,
        timestamp: 0,
    };
}

const cache: Cache = globalWithCache._tradingGraphCache;


// Cache'in ne kadar süre geçerli olacağı (milisaniye cinsinden). 1 saat.
const CACHE_DURATION = 60 * 60 * 1000;

/**
 * Mevcut takas grafiğini bellekten alır.
 * Eğer cache boşsa veya süresi dolmuşsa null döner.
 */
export function getCachedGraph(): TradingGraph | null {
    const isValid = cache.graph && (Date.now() - cache.timestamp < CACHE_DURATION);
    if (isValid) {
        console.log("Takas grafiği bellekten (in-memory cache) okundu.");
        return cache.graph;
    }
    console.log("Geçerli bir takas grafiği bellekte bulunamadı.");
    return null;
}

/**
 * Yeni oluşturulan bir takas grafiğini belleğe yazar.
 * @param graph - pathfinder.ts'deki buildTradingGraph ile oluşturulan graf.
 */
export function setCachedGraph(graph: TradingGraph): void {
    console.log("Yeni takas grafiği belleğe yazıldı.");
    cache.graph = graph;
    cache.timestamp = Date.now();
}