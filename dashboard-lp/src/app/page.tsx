"use client";

import { useState, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { Header } from '@/components/Header';
import { InfoCards } from '@/components/InfoCards';
import { FilterBar } from '@/components/FilterBar';
import { LPCard } from '@/components/LPCard';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingMessage } from '@/components/LoadingMessage';
import { useFactoryInfo } from '@/hooks/useFactoryInfo';
import { useTrackedBalances } from '@/hooks/useTrackedBalances';
import { useLPPositions } from '@/hooks/useLPPositions';
import { useWithdraw } from '@/hooks/useWithdraw';

export default function Home() {
  // Environment variables
  const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;
  const ROUTER_ADDRESS = process.env.NEXT_PUBLIC_ROUTER_ADDRESS!;
  const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS!;
  const TARGET_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TARGET_TOKEN_ADDRESS!;
  const WALLET_TO_CHECK = process.env.NEXT_PUBLIC_WALLET_ADDRESS!;

  // Provider setup
  const provider = useMemo(() => new ethers.JsonRpcProvider(RPC_URL), [RPC_URL]);

  // State
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [minValue, setMinValue] = useState<string>('');
  const [maxValue, setMaxValue] = useState<string>('');
  const [sortBy,] = useState<string>('value');
  const [sortOrder,] = useState<'asc' | 'desc'>('desc');
  const [targetTokenSymbol, setTargetTokenSymbol] = useState<string>('');

  // Custom hooks
  const { positions, isLoading, error, infoMessage, cacheTimestamp, totalPortfolioValue, fetchLpPositions } = useLPPositions({
    walletAddress: WALLET_TO_CHECK
  });

  const { factoryInfo, fetchFactoryInfo } = useFactoryInfo(provider, FACTORY_ADDRESS, ROUTER_ADDRESS);
  const { trackedBalances, fetchTrackedBalances } = useTrackedBalances(provider, WALLET_TO_CHECK);
  const { txStatus, txError, handleWithdraw, setTxError } = useWithdraw({
    onSuccess: () => fetchLpPositions(true),
    targetTokenAddress: TARGET_TOKEN_ADDRESS,
    walletAddress: WALLET_TO_CHECK
  });

  // Effects
  useEffect(() => {
    const fetchTargetTokenSymbol = async () => {
      if (TARGET_TOKEN_ADDRESS && provider) {
        try {
          const tokenContract = new ethers.Contract(TARGET_TOKEN_ADDRESS, ['function symbol() view returns (string)'], provider);
          const symbol = await tokenContract.symbol();
          setTargetTokenSymbol(symbol);
        } catch (e) {
          console.error("Hedef token sembolü alınamadı:", e);
          setTargetTokenSymbol('???');
        }
      }
    };
    fetchTargetTokenSymbol();
  }, [TARGET_TOKEN_ADDRESS, provider]);

  useEffect(() => {
    if (WALLET_TO_CHECK) {
      fetchLpPositions(false);
      fetchTrackedBalances();
      fetchFactoryInfo();
    }
  }, [fetchLpPositions, fetchTrackedBalances, fetchFactoryInfo, WALLET_TO_CHECK]);

  // Handlers
  const handleRefresh = () => {
    fetchLpPositions(true);
    fetchTrackedBalances();
  };

  const handleHardRefresh = () => {
    console.log("Performing a hard refresh by clearing cache and reloading...");
    localStorage.removeItem(`lpPositionsCache_${WALLET_TO_CHECK}_${TARGET_TOKEN_ADDRESS}`);
    localStorage.removeItem('tokenSymbolMapCache');
    window.location.reload();
  };

  // Memoized values
  const filteredAndSortedPositions = useMemo(() => {
    let filtered = [...positions];
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(pos =>
        pos.token0.symbol.toLowerCase().includes(searchLower) ||
        pos.token1.symbol.toLowerCase().includes(searchLower) ||
        pos.pairAddress.toLowerCase().includes(searchLower)
      );
    }
    if (minValue) filtered = filtered.filter(pos => parseFloat(pos.totalValueUSD) >= parseFloat(minValue));
    if (maxValue) filtered = filtered.filter(pos => parseFloat(pos.totalValueUSD) <= parseFloat(maxValue));
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'value': comparison = parseFloat(b.totalValueUSD) - parseFloat(a.totalValueUSD); break;
        case 'share': comparison = parseFloat(b.poolShare) - parseFloat(a.poolShare); break;
        case 'pair': comparison = `${a.token0.symbol}/${a.token1.symbol}`.localeCompare(`${b.token0.symbol}/${b.token1.symbol}`); break;
      }
      return sortOrder === 'asc' ? -comparison : comparison;
    });
    return filtered;
  }, [positions, searchTerm, minValue, maxValue, sortBy, sortOrder]);


  return (
    <main className="flex min-h-screen flex-col items-center p-6 md:p-12 bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white">
      <div className="z-10 w-full max-w-7xl">
        <Header
          isLoading={isLoading}
          onRefresh={handleRefresh}
          onHardRefresh={handleHardRefresh}
        />

        <div className="p-8">
          <InfoCards
            signerAddress={WALLET_TO_CHECK}
            totalPortfolioValue={totalPortfolioValue}
            targetTokenSymbol={targetTokenSymbol}
            cacheTimestamp={cacheTimestamp}
            factoryInfo={factoryInfo}
            factoryAddress={FACTORY_ADDRESS}
            routerAddress={ROUTER_ADDRESS}
          />
        </div>
      </div>

      <ErrorMessage
        error={error}
        txError={txError}
        onClose={() => { setTxError(null); }}
      />

      <div className="mt-8 w-full max-w-8xl">
        <LoadingMessage
          isLoading={isLoading}
          infoMessage={infoMessage}
        />

        <FilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          minValue={minValue}
          onMinValueChange={setMinValue}
          maxValue={maxValue}
          onMaxValueChange={setMaxValue}
          targetTokenSymbol={targetTokenSymbol}
        />

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredAndSortedPositions.map((position) => (
            <LPCard
              key={position.pairAddress}
              position={position}
              targetTokenSymbol={targetTokenSymbol}
              onWithdraw={(position, percentage) => handleWithdraw(position, percentage)}
              isWithdrawing={txStatus[position.pairAddress] === 'pending'}
            />
          ))}
        </div>
      </div>
    </main>
  );
}