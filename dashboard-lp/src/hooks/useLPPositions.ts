import { useState, useCallback, useRef } from 'react';
import { LpPosition } from '@/types/lp';

interface UseLPPositionsProps {
    walletAddress: string;
}

export function useLPPositions({ walletAddress }: UseLPPositionsProps) {
    const [positions, setPositions] = useState<LpPosition[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [infoMessage, setInfoMessage] = useState<string>('Başlatılıyor...');
    const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null);
    const [totalPortfolioValue, setTotalPortfolioValue] = useState<number>(0);
    const isFetchingRef = useRef(false);

    const fetchLpPositions = useCallback(async (forceRefresh = false) => {
        // Note: forceRefresh is not really used here anymore as the data is always fetched from the server cache.
        // It could be used to add a cache-busting query param if needed.
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;

        setIsLoading(true);
        setError(null);
        setInfoMessage('Pozisyonlar sunucudan alınıyor...');

        if (!walletAddress) {
            setError('Cüzdan adresi bulunamadı.');
            setIsLoading(false);
            isFetchingRef.current = false;
            return;
        }

        try {
            const response = await fetch(`/api/positions/${walletAddress}`);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Sunucudan pozisyonlar alınamadı.');
            }

            const { data, totalValue, timestamp } = await response.json();

            setPositions(data || []);
            setTotalPortfolioValue(totalValue || 0);
            setCacheTimestamp(timestamp || null);
            setInfoMessage(`${(data || []).length} pozisyon bulundu.`);

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Veri alınırken bir hata oluştu.';
            console.error('Veri yükleme hatası:', err);
            setError(message);
            setInfoMessage('Hata oluştu.');
        } finally {
            setIsLoading(false);
            isFetchingRef.current = false;
        }
    }, [walletAddress]);

    return {
        positions,
        isLoading,
        error,
        infoMessage,
        cacheTimestamp,
        totalPortfolioValue,
        fetchLpPositions
    };
}