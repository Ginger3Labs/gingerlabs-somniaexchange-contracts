import { useState, useCallback } from 'react';
import { LpPosition } from '@/types/lp';
import { withdrawLiquidity } from '@/services/api';

interface UseWithdrawProps {
    onSuccess: () => void;
    targetTokenAddress: string;
    walletAddress: string;
}

export function useWithdraw({ onSuccess, targetTokenAddress, walletAddress }: UseWithdrawProps) {
    const [txStatus, setTxStatus] = useState<{ [pairAddress: string]: string }>({});
    const [txError, setTxError] = useState<string | null>(null);

    const handleWithdraw = useCallback(async (position: LpPosition, percentage: number, options?: { skipCallbacks?: boolean }) => {
        if (percentage <= 0 || percentage > 100) {
            setTxError("Geçersiz yüzde değeri.");
            return;
        }

        setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'pending' }));
        setTxError(null);

        try {
            await withdrawLiquidity({
                pairAddress: position.pairAddress,
                token0Address: position.token0.address,
                token1Address: position.token1.address,
                percentage,
                totalValueUSD: parseFloat(position.totalValueUSD),
                targetTokenAddress
            });

            setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'success' }));

            if (!options?.skipCallbacks) {
                // Update the single position right after successful withdrawal
                try {
                    await fetch('/api/positions/update-single', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            pairAddress: position.pairAddress,
                            walletAddress: walletAddress,
                        }),
                    });
                } catch (updateError) {
                    console.error("Failed to update single position after withdraw:", updateError);
                    // Don't block the UI flow, just log the error. The full refresh will fix it.
                }
                onSuccess();
            }

            setTimeout(() => {
                setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'idle' }));
            }, 3000);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'İşlem başarısız oldu.';
            console.error("Withdraw error:", error);
            setTxError(message);
            setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'error' }));

            setTimeout(() => {
                setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'idle' }));
                setTxError(null);
            }, 5000);
        }
    }, [onSuccess, targetTokenAddress, walletAddress]);

    return {
        txStatus,
        txError,
        handleWithdraw,
        setTxError
    };
}