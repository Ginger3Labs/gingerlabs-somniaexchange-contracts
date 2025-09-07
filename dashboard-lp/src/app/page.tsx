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
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [bulkWithdrawPercentage, setBulkWithdrawPercentage] = useState<number>(100);
  const [selectValue, setSelectValue] = useState<string>('0.5');

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

  const handleSelectionChange = (pairAddress: string) => {
    setSelectedPositions(prev =>
      prev.includes(pairAddress)
        ? prev.filter(p => p !== pairAddress)
        : [...prev, pairAddress]
    );
  };

  const handleSelectByValue = () => {
    const maxValue = parseFloat(selectValue);
    if (isNaN(maxValue)) return;

    const positionsToSelect = positions
      .filter(p => parseFloat(p.totalValueUSD) < maxValue)
      .map(p => p.pairAddress);

    // Select only the new ones, don't deselect existing ones
    setSelectedPositions(prev => [...new Set([...prev, ...positionsToSelect])]);
  };

  const handleBulkWithdraw = async () => {
    const positionsToWithdraw = positions.filter(p => selectedPositions.includes(p.pairAddress));
    const withdrawnPairAddresses: string[] = [];

    // Perform blockchain transactions sequentially
    for (const position of positionsToWithdraw) {
      try {
        // We reuse the single withdraw logic for the transaction part
        await handleWithdraw(position, bulkWithdrawPercentage, { skipCallbacks: true });
        withdrawnPairAddresses.push(position.pairAddress);
      } catch (e) {
        console.error(`Failed to withdraw from ${position.pairAddress}:`, e);
        // If one fails, we stop and refresh the data for the ones that succeeded
        break;
      }
    }

    // After all successful transactions, perform a single bulk update
    if (withdrawnPairAddresses.length > 0) {
      try {
        const res = await fetch('/api/positions/update-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairAddresses: withdrawnPairAddresses,
            walletAddress: WALLET_TO_CHECK,
          }),
        });
        if (!res.ok) {
          throw new Error('Failed to bulk update positions');
        }
        console.log('Bulk update successful for:', withdrawnPairAddresses);
      } catch (error) {
        console.error('Error during bulk position update:', error);
      } finally {
        // Always refresh the main data from the cache after the operation
        fetchLpPositions(true);
      }
    }

    setSelectedPositions([]); // Clear selection after the entire process
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

        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="flex-grow w-full">
            <FilterBar
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              minValue={minValue}
              onMinValueChange={setMinValue}
              maxValue={maxValue}
              onMaxValueChange={setMaxValue}
              targetTokenSymbol={targetTokenSymbol}
            />
          </div>
          <div className="flex-shrink-0 flex items-center gap-2 p-2 bg-gray-800/50 rounded-xl border border-gray-700/50 w-full md:w-auto">
            <span className="text-sm text-gray-300">Değeri şundan az olanları seç:</span>
            <input
              type="number"
              step="0.1"
              value={selectValue}
              onChange={(e) => setSelectValue(e.target.value)}
              className="px-2 py-1 w-20 bg-gray-900/50 rounded-md border border-gray-700/30 focus:border-blue-500/50 focus:outline-none transition-colors"
              placeholder="0.5"
            />
            <button
              onClick={handleSelectByValue}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-4 rounded-md transition-colors"
            >
              Seç
            </button>
          </div>
        </div>

        {selectedPositions.length > 0 && (
          <div className="my-4 p-4 bg-gray-800/50 border border-blue-500/30 rounded-xl flex items-center justify-between gap-4">
            <div className='flex items-center gap-4'>
              <span className="text-lg font-medium text-white">{selectedPositions.length} pozisyon seçildi</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={bulkWithdrawPercentage}
                  onChange={(e) => setBulkWithdrawPercentage(parseInt(e.target.value, 10) || 0)}
                  className="px-3 py-2 w-24 bg-gray-900/50 rounded-xl border border-gray-700/30 focus:border-blue-500/50 focus:outline-none transition-colors"
                  placeholder="%"
                />
                <span className='text-white'>%</span>
              </div>
            </div>
            <div className="text-right">
              <button
                onClick={handleBulkWithdraw}
                disabled={Object.values(txStatus).some(s => s === 'pending')}
                className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-bold py-2 px-6 rounded-xl disabled:from-gray-600 disabled:to-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg"
              >
                Seçilenleri Çek
              </button>
              <p className="text-xs text-gray-400 mt-1">Her işlem için ayrı cüzdan onayı gerekecektir.</p>
            </div>
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredAndSortedPositions.map((position) => (
            <LPCard
              key={position.pairAddress}
              position={position}
              targetTokenSymbol={targetTokenSymbol}
              onWithdraw={(position, percentage) => handleWithdraw(position, percentage)}
              isWithdrawing={txStatus[position.pairAddress] === 'pending'}
              isSelected={selectedPositions.includes(position.pairAddress)}
              onSelectionChange={handleSelectionChange}
            />
          ))}
        </div>
      </div>
    </main>
  );
}