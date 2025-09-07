import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { getBestAmountOut } from '@/lib/pathfinder';

interface UseNativeBalanceProps {
    provider: ethers.Provider | null;
    walletAddress: string;
    wrappedTokenAddress: string;
    targetTokenAddress: string;
    factoryAddress: string;
    routerAddress: string;
}

export function useNativeBalance({
    provider,
    walletAddress,
    wrappedTokenAddress,
    targetTokenAddress,
    factoryAddress,
    routerAddress,
}: UseNativeBalanceProps) {
    const [nativeBalance, setNativeBalance] = useState<string>('0.0');
    const [valueInTarget, setValueInTarget] = useState<string>('0.0');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const fetchNativeBalance = useCallback(async () => {
        if (!provider || !walletAddress || !wrappedTokenAddress || !targetTokenAddress || !factoryAddress || !routerAddress) {
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // 1. Fetch native balance
            const balanceBigInt = await provider.getBalance(walletAddress);
            const formattedBalance = ethers.formatEther(balanceBigInt);
            setNativeBalance(formattedBalance);

            // 2. Calculate its value in the target token
            if (balanceBigInt > 0n) {
                // Get price of 1 native token (represented by its wrapped version) in target token
                const oneEther = ethers.parseEther('1');
                const { amount: pricePerNative } = await getBestAmountOut(
                    wrappedTokenAddress,
                    targetTokenAddress,
                    oneEther,
                    routerAddress,
                    factoryAddress,
                    provider
                );

                if (pricePerNative > 0n) {
                    const totalValueBigInt = (balanceBigInt * pricePerNative) / oneEther;

                    // We need the target token's decimals for accurate formatting.
                    const targetTokenContract = new ethers.Contract(targetTokenAddress, ['function decimals() view returns (uint8)'], provider);
                    const targetTokenDecimals = await targetTokenContract.decimals();
                    const formattedValue = ethers.formatUnits(totalValueBigInt, Number(targetTokenDecimals));
                    setValueInTarget(formattedValue);
                } else {
                    setValueInTarget('0.0');
                }
            } else {
                setValueInTarget('0.0');
            }

        } catch (e) {
            console.error("Failed to fetch native balance or its value:", e);
            setError("Native bakiye alınamadı.");
            setNativeBalance('0.0');
            setValueInTarget('0.0');
        } finally {
            setIsLoading(false);
        }
    }, [provider, walletAddress, wrappedTokenAddress, targetTokenAddress, factoryAddress, routerAddress]);

    return { nativeBalance, valueInTarget, isLoading, error, fetchNativeBalance };
}