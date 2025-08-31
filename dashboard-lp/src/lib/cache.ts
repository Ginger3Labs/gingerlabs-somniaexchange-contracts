import { TradingGraph } from './pathfinder';
import fs from 'fs/promises';
import path from 'path';

// Geliştirme ortamında projenin kök dizininde bir cache dosyası oluşturur.
// Production'da Vercel gibi platformların geçici dosya sistemini kullanır.
const CACHE_FILE_PATH = path.join(process.cwd(), '.trading-graph-cache.json');
const CACHE_DURATION = 60 * 60 * 1000; // 1 saat

interface CacheEntry {
    timestamp: number;
    graph: [string, { pairAddress: string, otherToken: string }[]][];
}

// Helper: Map'i JSON'a çevirilebilir bir array'e dönüştürür.
function mapToJson(map: TradingGraph): [string, { pairAddress: string, otherToken: string }[]][] {
    return Array.from(map.entries());
}

// Helper: Array'i tekrar Map'e dönüştürür.
function jsonToMap(json: [string, { pairAddress: string, otherToken: string }[]][]): TradingGraph {
    return new Map(json);
}

/**
 * Mevcut takas grafiğini dosya sistemindeki cache'den okur.
 * Eğer cache dosyası yoksa veya süresi dolmuşsa null döner.
 */
export async function getCachedGraph(): Promise<TradingGraph | null> {
    try {
        const fileContent = await fs.readFile(CACHE_FILE_PATH, 'utf-8');
        const cachedData: CacheEntry = JSON.parse(fileContent);

        const isCacheValid = (Date.now() - cachedData.timestamp) < CACHE_DURATION;

        if (isCacheValid) {
            console.log("Takas grafiği dosyadan (file system cache) okundu.");
            return jsonToMap(cachedData.graph);
        }

        console.log("Dosyadaki takas grafiğinin süresi dolmuş.");
        return null;
    } catch (error) {
        // Dosya yoksa veya okuma hatası olursa, bu bir hata değil, cache'in boş olduğu anlamına gelir.
        console.log("Geçerli bir takas grafiği cache dosyası bulunamadı.");
        return null;
    }
}

/**
 * Yeni oluşturulan bir takas grafiğini dosya sistemine yazar.
 * @param graph - pathfinder.ts'deki buildTradingGraph ile oluşturulan graf.
 */
export async function setCachedGraph(graph: TradingGraph): Promise<void> {
    try {
        const cacheEntry: CacheEntry = {
            timestamp: Date.now(),
            graph: mapToJson(graph),
        };
        await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(cacheEntry, null, 2));
        console.log("Yeni takas grafiği dosyaya yazıldı:", CACHE_FILE_PATH);
    } catch (error) {
        console.error("Takas grafiği cache dosyasına yazılamadı:", error);
    }
}