import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import ERC20ABI from '@/abis/IERC20.json';
import { TrackedTokenBalance } from '@/types/lp';

export function useTrackedBalances(
    provider: ethers.Provider,
    walletAddress: string
) {
    const [trackedBalances, setTrackedBalances] = useState<TrackedTokenBalance[]>([]);

    const fetchTrackedBalances = useCallback(async () => {
        const trackedTokensEnv = process.env.NEXT_PUBLIC_TRACKED_TOKEN_ADDRESSES || '';
        if (!trackedTokensEnv || !walletAddress) return;

        const tokenAddresses = trackedTokensEnv.split(',').map(addr => addr.trim());

        try {
            const balancePromises = tokenAddresses.map(async (address) => {
                const tokenContract = new ethers.Contract(address, ERC20ABI.abi, provider);
                const [balance, decimals, symbol] = await Promise.all([
                    tokenContract.balanceOf(walletAddress),
                    tokenContract.decimals(),
                    tokenContract.symbol()
                ]);
                return {
                    address,
                    symbol,
                    balance: ethers.formatUnits(balance, decimals)
                };
            });

            const balances = await Promise.all(balancePromises);
            setTrackedBalances(balances);
        } catch (error) {
            console.error("Takip edilen token bakiyeleri alınamadı:", error);
        }
    }, [provider, walletAddress]);

    return { trackedBalances, fetchTrackedBalances };
}

