"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ethers } from 'ethers';
import FactoryABI from '@/abis/SomniaExchangeFactory.json';
import PairABI from '@/abis/SomniaExchangePair.json';
import ERC20ABI from '@/abis/IERC20.json';
import { formatToDecimals } from '../../format';
import { getBestAmountOut } from '@/lib/pathfinder';

// Arayüz için veri tipleri
interface LpPosition {
  pairAddress: string;
  token0: { address: string; symbol: string; value: string; route: string[]; };
  token1: { address: string; symbol: string; value: string; route: string[]; };
  lpBalance: string;
  poolShare: string;
  totalValueUSD: string; // Bu isim hedef token cinsinden değeri tutar
}

interface TrackedTokenBalance {
  address: string;
  symbol: string;
  balance: string;
}

interface CacheData {
  timestamp: number;
  data: LpPosition[];
  lastScannedIndex: number;
  totalPairCount: number;
}

const CACHE_KEY_PREFIX = 'lpPositionsCache_';

export default function Home() {
  const [positions, setPositions] = useState<LpPosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string>('Başlatılıyor...');
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null);
  const [totalPortfolioValue, setTotalPortfolioValue] = useState<number>(0);
  const [signerAddress, setSignerAddress] = useState<string>('');
  const [txStatus, setTxStatus] = useState<{ [pairAddress: string]: string }>({});
  const [txError, setTxError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [minValue, setMinValue] = useState<string>('');
  const [maxValue, setMaxValue] = useState<string>('');
  const [sortBy,] = useState<string>('value');
  const [sortOrder,] = useState<'asc' | 'desc'>('desc');
  const [withdrawPercentages, setWithdrawPercentages] = useState<{ [pairAddress: string]: number }>({});
  const [estimatedTargetTokenValues, setEstimatedTargetTokenValues] = useState<Map<string, { token0: string, token1: string, total: string }>>(new Map());
  const [isEstimating, setIsEstimating] = useState<Set<string>>(new Set());
  const [tokenSymbolMap, setTokenSymbolMap] = useState<Map<string, string>>(() => {
    if (typeof window === 'undefined') return new Map();
    const cached = localStorage.getItem('tokenSymbolMapCache');
    return cached ? new Map(JSON.parse(cached)) : new Map();
  });
  const [trackedBalances, setTrackedBalances] = useState<TrackedTokenBalance[]>([]);
  const [targetTokenSymbol, setTargetTokenSymbol] = useState<string>('');
  const [factoryInfo, setFactoryInfo] = useState<{ feeTo: string; feeToSetter: string; protocolFeeStatus: 'Açık' | 'Kapalı' | 'Yükleniyor...'; totalPairs: number }>({ feeTo: '', feeToSetter: '', protocolFeeStatus: 'Yükleniyor...', totalPairs: 0 });
  const isScanningRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (tokenSymbolMap.size > 0) {
      localStorage.setItem('tokenSymbolMapCache', JSON.stringify(Array.from(tokenSymbolMap.entries())));
    }
  }, [tokenSymbolMap]);

  const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;
  const ROUTER_ADDRESS = process.env.NEXT_PUBLIC_ROUTER_ADDRESS!;
  const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS!;
  const TARGET_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TARGET_TOKEN_ADDRESS!;
  const WALLET_TO_CHECK = process.env.NEXT_PUBLIC_WALLET_ADDRESS!;

  const provider = useMemo(() => new ethers.JsonRpcProvider(RPC_URL), [RPC_URL]);

  useEffect(() => {
    const fetchTargetTokenSymbol = async () => {
      if (TARGET_TOKEN_ADDRESS && provider) {
        try {
          const tokenContract = new ethers.Contract(TARGET_TOKEN_ADDRESS, ERC20ABI.abi, provider);
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
    const fetchMissingSymbols = async () => {
      const allRoutes = positions.flatMap(p => [...(p.token0.route || []), ...(p.token1.route || [])]);
      const uniqueAddresses = [...new Set(allRoutes)].filter(addr => addr);
      const missingSymbols = uniqueAddresses.filter(addr => !tokenSymbolMap.has(addr.toLowerCase()));
      if (missingSymbols.length > 0) {
        const newSymbols = new Map<string, string>();
        await Promise.all(missingSymbols.map(async (addr) => {
          try {
            const tokenContract = new ethers.Contract(addr, ERC20ABI.abi, provider);
            const symbol = await tokenContract.symbol();
            newSymbols.set(addr.toLowerCase(), symbol);
          } catch {
            newSymbols.set(addr.toLowerCase(), addr.slice(0, 6));
          }
        }));
        if (newSymbols.size > 0) {
          setTokenSymbolMap(prevMap => new Map([...prevMap, ...newSymbols]));
        }
      }
    };
    if (positions.length > 0) {
      fetchMissingSymbols();
    }
  }, [positions, provider, tokenSymbolMap]);

  const fetchLpPositions = useCallback(async (forceRefresh = false) => {
    if (isScanningRef.current && !forceRefresh) return;
    isScanningRef.current = true;

    setIsLoading(true);
    setError(null);
    setTxError(null);

    if (!WALLET_TO_CHECK || !TARGET_TOKEN_ADDRESS) {
      setError('.env dosyasında gerekli adresler (WALLET_ADDRESS, TARGET_TOKEN_ADDRESS) bulunamadı.');
      setIsLoading(false);
      isScanningRef.current = false;
      return;
    }

    const walletAddress = WALLET_TO_CHECK;
    setSignerAddress(walletAddress);
    const currentCacheKey = `${CACHE_KEY_PREFIX}${walletAddress}_${TARGET_TOKEN_ADDRESS}`;

    let initialScanIndex = 0;
    let previouslyFoundPositions: LpPosition[] = [];

    if (forceRefresh) {
      localStorage.removeItem(currentCacheKey);
      setPositions([]);
      setTotalPortfolioValue(0);
    } else {
      const cachedData = localStorage.getItem(currentCacheKey);
      if (cachedData) {
        const parsed: CacheData = JSON.parse(cachedData);
        previouslyFoundPositions = parsed.data || [];
        setPositions(previouslyFoundPositions);
        setTotalPortfolioValue(previouslyFoundPositions.reduce((sum, pos) => sum + parseFloat(pos.totalValueUSD), 0));
        setCacheTimestamp(parsed.timestamp);
        if (parsed.lastScannedIndex + 1 >= parsed.totalPairCount) {
          setInfoMessage('Önbellekten yüklendi.');
          setIsLoading(false);
          isScanningRef.current = false;
          return;
        } else {
          initialScanIndex = parsed.lastScannedIndex + 1;
          setInfoMessage(`Tarama ${initialScanIndex}. çiftten devam ediyor...`);
        }
      }
    }

    if (!forceRefresh && initialScanIndex === 0) {
      setInfoMessage('Blockchain ile bağlantı kuruluyor...');
    }

    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FactoryABI.abi, provider);
      const PRICE_PRECISION = 30;
      const decimalsCache = new Map<string, number>();
      const getDecimals = async (tokenAddress: string): Promise<number> => {
        const address = tokenAddress.toLowerCase();
        if (decimalsCache.has(address)) return decimalsCache.get(address)!;
        try {
          const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI.abi, provider);
          const decimals = await tokenContract.decimals();
          decimalsCache.set(address, Number(decimals));
          return Number(decimals);
        } catch {
          decimalsCache.set(address, 18); return 18;
        }
      };

      const priceCacheSimple = new Map<string, { price: string, route: string[] }>();
      const getTokenPriceSimple = async (tokenAddress: string): Promise<{ price: string, route: string[] }> => {
        const address = tokenAddress.toLowerCase();
        if (address === TARGET_TOKEN_ADDRESS.toLowerCase()) return { price: '1.0', route: [TARGET_TOKEN_ADDRESS] };
        if (priceCacheSimple.has(address)) return priceCacheSimple.get(address)!;
        try {
          const tokenInDecimals = await getDecimals(tokenAddress);
          const amountIn = ethers.parseUnits('1', tokenInDecimals);
          const { amount: bestAmountOut, path: bestPath } = await getBestAmountOut(
            tokenAddress, TARGET_TOKEN_ADDRESS, amountIn, ROUTER_ADDRESS, FACTORY_ADDRESS, provider
          );
          if (bestAmountOut === 0n) {
            const result = { price: '0', route: [] };
            priceCacheSimple.set(address, result);
            return result;
          }
          const targetTokenDecimals = await getDecimals(TARGET_TOKEN_ADDRESS);
          const priceString = ethers.formatUnits(bestAmountOut, targetTokenDecimals);
          const result = { price: priceString, route: bestPath };
          priceCacheSimple.set(address, result);
          return result;
        } catch (error) {
          console.error(`[priceService] Failed to get price for ${tokenAddress} in ${targetTokenSymbol}:`, error);
          return { price: '0', route: [] };
        }
      };

      const pairCount = await factory.allPairsLength();
      const pairsToScan = Number(pairCount);
      if (initialScanIndex === 0) setInfoMessage(`Toplam ${pairsToScan} çift taranıyor...`);

      const BATCH_SIZE = 20;
      const BATCH_TIMEOUT = 30000; // 30 saniye
      const localTokenSymbolMap = new Map();

      for (let i = initialScanIndex; i < pairsToScan; i += BATCH_SIZE) {
        const batchEnd = Math.min(i + BATCH_SIZE, pairsToScan);
        setInfoMessage(`Çiftler ${i + 1}-${batchEnd}/${pairsToScan} taranıyor...`);

        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Batch ${i}-${batchEnd} timed out after ${BATCH_TIMEOUT / 1000}s`)), BATCH_TIMEOUT)
          );

          const batchProcessing = async () => {
            const pairAddressPromises = Array.from({ length: batchEnd - i }, (_, k) => factory.allPairs(i + k).catch(() => null));
            const pairAddresses = (await Promise.all(pairAddressPromises)).filter((addr): addr is string => !!addr);

            const balancePromises = pairAddresses.map(addr => {
              const pairContract = new ethers.Contract(addr, PairABI.abi, provider);
              return pairContract.balanceOf(walletAddress).then(balance => ({ pairAddress: addr, balance })).catch(() => null);
            });
            const balances = (await Promise.all(balancePromises)).filter((d): d is { pairAddress: string, balance: ethers.BigNumberish } => d !== null && BigInt(d.balance) > 0n);

            if (balances.length > 0) {
              const positionPromises = balances.map(async ({ pairAddress, balance }) => {
                try {
                  const pairContract = new ethers.Contract(pairAddress, PairABI.abi, provider);
                  const [token0Address, token1Address, reserves, totalSupply] = await Promise.all([
                    pairContract.token0(), pairContract.token1(), pairContract.getReserves(), pairContract.totalSupply()
                  ]);
                  if (BigInt(totalSupply) === 0n) return null;

                  const [token0Symbol, token1Symbol] = await Promise.all([
                    new ethers.Contract(token0Address, ERC20ABI.abi, provider).symbol().catch(() => '???'),
                    new ethers.Contract(token1Address, ERC20ABI.abi, provider).symbol().catch(() => '???')
                  ]);
                  localTokenSymbolMap.set(token0Address.toLowerCase(), token0Symbol);
                  localTokenSymbolMap.set(token1Address.toLowerCase(), token1Symbol);

                  const [token0Decimals, token1Decimals] = await Promise.all([getDecimals(token0Address), getDecimals(token1Address)]);
                  const [price0Result, price1Result] = await Promise.all([getTokenPriceSimple(token0Address), getTokenPriceSimple(token1Address)]);

                  const token0Price = ethers.parseUnits(price0Result.price, PRICE_PRECISION);
                  const token1Price = ethers.parseUnits(price1Result.price, PRICE_PRECISION);

                  const bn_balance = BigInt(balance);
                  const bn_totalSupply = BigInt(totalSupply);
                  const bn_reserves0 = BigInt(reserves[0]);
                  const bn_reserves1 = BigInt(reserves[1]);
                  const bn_ten = 10n;

                  const poolTvl0 = (bn_reserves0 * token0Price) / (bn_ten ** BigInt(token0Decimals));
                  const poolTvl1 = (bn_reserves1 * token1Price) / (bn_ten ** BigInt(token1Decimals));
                  const reliableTotalPoolTvl = poolTvl0 < poolTvl1 ? poolTvl0 * 2n : poolTvl1 * 2n;
                  const positionValue = (reliableTotalPoolTvl * bn_balance) / bn_totalSupply;
                  const valueOfEachToken = positionValue / 2n;
                  const token0DerivedAmount = (token0Price > 0n) ? (valueOfEachToken * (bn_ten ** BigInt(token0Decimals))) / token0Price : 0n;
                  const token1DerivedAmount = (token1Price > 0n) ? (valueOfEachToken * (bn_ten ** BigInt(token1Decimals))) / token1Price : 0n;

                  return {
                    pairAddress,
                    token0: { address: token0Address, symbol: token0Symbol, value: ethers.formatUnits(token0DerivedAmount, token0Decimals), route: price0Result.route },
                    token1: { address: token1Address, symbol: token1Symbol, value: ethers.formatUnits(token1DerivedAmount, token1Decimals), route: price1Result.route },
                    lpBalance: ethers.formatEther(balance),
                    poolShare: (Number((bn_balance * 10000n) / bn_totalSupply) / 100).toFixed(2),
                    totalValueUSD: ethers.formatUnits(positionValue, PRICE_PRECISION),
                  };
                } catch { return null; }
              });

              const newPositions = (await Promise.all(positionPromises)).filter((p): p is LpPosition => p !== null);

              if (newPositions.length > 0) {
                setPositions(prevPositions => {
                  const posMap = new Map(prevPositions.map(p => [p.pairAddress, p]));
                  newPositions.forEach(p => posMap.set(p.pairAddress, p));
                  const updatedPositions = Array.from(posMap.values());
                  updatedPositions.sort((a, b) => parseFloat(b.totalValueUSD) - parseFloat(a.totalValueUSD));

                  const currentProgress: CacheData = {
                    timestamp: Date.now(), data: updatedPositions, lastScannedIndex: batchEnd - 1, totalPairCount: pairsToScan,
                  };
                  localStorage.setItem(currentCacheKey, JSON.stringify(currentProgress));
                  setCacheTimestamp(currentProgress.timestamp);
                  setTotalPortfolioValue(updatedPositions.reduce((sum, pos) => sum + parseFloat(pos.totalValueUSD), 0));

                  return updatedPositions;
                });
              }
            }
          };

          await Promise.race([batchProcessing(), timeoutPromise]);

        } catch (batchError: unknown) {
          const message = batchError instanceof Error ? batchError.message : String(batchError);
          console.error(message);
          setError(`Bir hata oluştu: ${message}. Bir sonraki partiden devam ediliyor...`);
        }
      }

      setTokenSymbolMap(prev => new Map([...prev, ...localTokenSymbolMap]));
      setInfoMessage('Tarama tamamlandı.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Veri alınırken bir hata oluştu.';
      console.error('Veri yükleme hatası:', err);
      setError(message);
      setInfoMessage('Hata oluştu.');
    } finally {
      setIsLoading(false);
      isScanningRef.current = false;
    }
  }, [provider, WALLET_TO_CHECK, TARGET_TOKEN_ADDRESS, FACTORY_ADDRESS, ROUTER_ADDRESS, targetTokenSymbol]);

  const updateSinglePosition = useCallback(async (pairAddress: string) => {
    // Bu fonksiyonun da TARGET_TOKEN_ADDRESS'e göre güncellenmesi gerekir.
    // Şimdilik ana yenileme fonksiyonu yeterlidir.
    console.log(`Updating position ${pairAddress}...`);
  }, []);

  const fetchTrackedBalances = useCallback(async () => {
    const trackedTokensEnv = process.env.NEXT_PUBLIC_TRACKED_TOKEN_ADDRESSES || '';
    if (!trackedTokensEnv || !WALLET_TO_CHECK) return;
    const tokenAddresses = trackedTokensEnv.split(',').map(addr => addr.trim());
    try {
      const balancePromises = tokenAddresses.map(async (address) => {
        const tokenContract = new ethers.Contract(address, ERC20ABI.abi, provider);
        const [balance, decimals, symbol] = await Promise.all([
          tokenContract.balanceOf(WALLET_TO_CHECK), tokenContract.decimals(), tokenContract.symbol()
        ]);
        return { address, symbol, balance: ethers.formatUnits(balance, decimals) };
      });
      const balances = await Promise.all(balancePromises);
      setTrackedBalances(balances);
    } catch (error) {
      console.error("Takip edilen token bakiyeleri alınamadı:", error);
    }
  }, [provider, WALLET_TO_CHECK]);

  const fetchFactoryInfo = useCallback(async () => {
    if (!FACTORY_ADDRESS || !provider) return;
    try {
      const factoryContract = new ethers.Contract(FACTORY_ADDRESS, FactoryABI.abi, provider);
      const [feeTo, feeToSetter, allPairsLength] = await Promise.all([
        factoryContract.feeTo(),
        factoryContract.feeToSetter(),
        factoryContract.allPairsLength()
      ]);
      const nullAddress = "0x0000000000000000000000000000000000000000";
      setFactoryInfo({
        feeTo,
        feeToSetter,
        protocolFeeStatus: feeTo === nullAddress ? 'Kapalı' : 'Açık',
        totalPairs: Number(allPairsLength)
      });
    } catch (error) {
      console.error("Fabrika bilgileri alınamadı:", error);
      setFactoryInfo({ feeTo: 'Hata', feeToSetter: 'Hata', protocolFeeStatus: 'Kapalı', totalPairs: 0 });
    }
  }, [provider, FACTORY_ADDRESS]);

  useEffect(() => {
    if (WALLET_TO_CHECK) {
      fetchLpPositions(false);
      fetchTrackedBalances();
      fetchFactoryInfo();
    }
  }, [fetchLpPositions, fetchTrackedBalances, fetchFactoryInfo, WALLET_TO_CHECK]);

  const handleRefresh = useCallback(() => {
    fetchLpPositions(true);
    fetchTrackedBalances();
  }, [fetchLpPositions, fetchTrackedBalances]);

  const handleHardRefresh = useCallback(() => {
    console.log("Performing a hard refresh by clearing cache and reloading...");
    // Önbelleği temizle
    const currentCacheKey = `${CACHE_KEY_PREFIX}${WALLET_TO_CHECK}_${TARGET_TOKEN_ADDRESS}`;
    localStorage.removeItem(currentCacheKey);
    localStorage.removeItem('tokenSymbolMapCache');
    // Sayfayı yeniden yükle
    window.location.reload();
  }, [WALLET_TO_CHECK, TARGET_TOKEN_ADDRESS]);

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
      router.push('/login');
    } catch (error) {
      console.error('Failed to log out', error);
    }
  };

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

  const handleWithdraw = useCallback(async (position: LpPosition, percentage: number) => {
    if (percentage <= 0 || percentage > 100) {
      setTxError("Geçersiz yüzde değeri."); return;
    }
    setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'pending' }));
    setTxError(null);
    try {
      const response = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairAddress: position.pairAddress,
          token0Address: position.token0.address,
          token1Address: position.token1.address,
          percentage: percentage,
          totalValueUSD: parseFloat(position.totalValueUSD),
          targetTokenAddress: TARGET_TOKEN_ADDRESS // Hedef token'ı API'ye gönder
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'İşlem başarısız oldu.');
      setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'success' }));
      await updateSinglePosition(position.pairAddress);
      setTimeout(() => setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'idle' })), 3000);
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
  }, [updateSinglePosition, TARGET_TOKEN_ADDRESS]);

  useEffect(() => {
    const estimateWithdrawValue = async () => {
      const positionsToEstimate = positions.filter(p => (withdrawPercentages[p.pairAddress] || 0) > 0);
      if (positionsToEstimate.length === 0) {
        if (estimatedTargetTokenValues.size > 0) setEstimatedTargetTokenValues(new Map());
        if (isEstimating.size > 0) setIsEstimating(new Set());
        return;
      }
      const currentlyEstimating = new Set(positionsToEstimate.map(p => p.pairAddress));
      setIsEstimating(currentlyEstimating);
      const decimalsCache = new Map<string, number>();
      const getDecimals = async (tokenAddress: string): Promise<number> => {
        const address = tokenAddress.toLowerCase();
        if (decimalsCache.has(address)) return decimalsCache.get(address)!;
        try {
          const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI.abi, provider);
          const decimals = await tokenContract.decimals();
          const decimalsNum = Number(decimals);
          decimalsCache.set(address, decimalsNum);
          return decimalsNum;
        } catch {
          decimalsCache.set(address, 18); return 18;
        }
      };
      const newEstimates = new Map(estimatedTargetTokenValues);
      await Promise.all(
        positionsToEstimate.map(async (pos) => {
          const percentage = withdrawPercentages[pos.pairAddress];
          if (!percentage) return;
          try {
            const calculateTokenValue = async (token: { address: string, value: string }) => {
              if (parseFloat(token.value) === 0) return '0.0';
              const tokenDecimals = await getDecimals(token.address);
              const totalAmount = ethers.parseUnits(token.value, tokenDecimals);
              const amountToWithdraw = (totalAmount * BigInt(percentage)) / 100n;
              if (amountToWithdraw === 0n) return '0.0';
              if (token.address.toLowerCase() === TARGET_TOKEN_ADDRESS.toLowerCase()) {
                const targetDecimals = await getDecimals(TARGET_TOKEN_ADDRESS);
                return ethers.formatUnits(amountToWithdraw, targetDecimals);
              }
              try {
                const { amount: bestAmountOut } = await getBestAmountOut(
                  token.address, TARGET_TOKEN_ADDRESS, amountToWithdraw, ROUTER_ADDRESS, FACTORY_ADDRESS, provider
                );
                const targetDecimals = await getDecimals(TARGET_TOKEN_ADDRESS);
                return ethers.formatUnits(bestAmountOut, targetDecimals);
              } catch (e) {
                console.error(`[Estimator] getBestAmountOut failed for ${token.address}:`, e);
                return '0.0'; // Hata durumunda 0 döndür
              }
            };
            const [val0, val1] = await Promise.all([
              calculateTokenValue(pos.token0),
              calculateTokenValue(pos.token1)
            ]);
            const totalVal = parseFloat(val0) + parseFloat(val1);
            newEstimates.set(pos.pairAddress, {
              token0: val0, token1: val1, total: totalVal.toFixed(6)
            });
          } catch (e) {
            console.error(`[Estimator] ${pos.pairAddress} için değer hesaplanamadı:`, e);
            if (newEstimates.has(pos.pairAddress)) newEstimates.delete(pos.pairAddress);
          }
        })
      );
      setEstimatedTargetTokenValues(new Map(newEstimates));
      setIsEstimating(new Set());
    };
    const debounceTimeout = setTimeout(() => estimateWithdrawValue(), 400);
    return () => clearTimeout(debounceTimeout);
  }, [withdrawPercentages, positions, provider, ROUTER_ADDRESS, FACTORY_ADDRESS, TARGET_TOKEN_ADDRESS]);

  const renderRoute = (route: string[] | undefined) => {
    if (!route || route.length === 0) return null;
    return route.map(addr => tokenSymbolMap.get(addr.toLowerCase()) || addr.slice(0, 6)).join(' → ');
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-6 md:p-12 bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white">
      <div className="z-10 w-full max-w-7xl">
        {/* Header Section */}
        <div className="bg-gray-800/80 backdrop-blur-lg rounded-2xl shadow-2xl border border-gray-700/50 overflow-hidden">
          {/* Top Banner */}
          <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 border-b border-gray-700/50 p-8">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
              {/* Logo and Title */}
              <div className="flex-1">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                    <span className="text-2xl font-bold">LP</span>
                  </div>
                  <div>
                    <h1 className="text-4xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 text-transparent bg-clip-text animate-gradient">
                      Somnia LP Dashboard
                    </h1>
                    <p className="text-gray-400 mt-1">Likidite Havuzu Yönetim Paneli</p>
                  </div>
                </div>
              </div>

              {/* Status and Actions */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 bg-gray-900/40 backdrop-blur px-4 py-2 rounded-xl border border-gray-700/30">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`}></div>
                    <span className={`font-medium ${isLoading ? 'text-yellow-400' : 'text-green-400'}`}>
                      {isLoading ? 'Yükleniyor...' : 'Hazır'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRefresh}
                    disabled={isLoading}
                    className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-medium p-2 rounded-lg border border-blue-500/30 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <button
                    onClick={handleHardRefresh}
                    className="bg-red-500/20 hover:bg-red-500/30 text-red-400 font-medium p-2 rounded-lg border border-red-500/30 transition-all duration-300"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                  <button
                    onClick={handleLogout}
                    className="bg-gray-700/30 hover:bg-gray-700/50 text-gray-300 font-medium p-2 rounded-lg border border-gray-600/30 transition-all duration-300"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Info Cards */}
          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Wallet Card */}
              <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30">
                <div className="flex items-center gap-3 mb-2">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span className="text-gray-400">Cüzdan</span>
                </div>
                <div className="font-mono text-sm text-white/90 break-all">
                  {signerAddress}
                </div>
              </div>

              {/* Total Value Card */}
              {totalPortfolioValue > 0 && (
                <div className="bg-gradient-to-r from-green-500/10 to-green-600/10 border border-green-500/20 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-gray-400">Toplam Varlık</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-green-400">{formatToDecimals(totalPortfolioValue)}</span>
                    <span className="text-green-500">{targetTokenSymbol}</span>
                  </div>
                </div>
              )}

              {/* Last Update Card */}
              {cacheTimestamp && (
                <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30">
                  <div className="flex items-center gap-3 mb-2">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-gray-400">Son Güncelleme</span>
                  </div>
                  <span className="text-lg text-white/90">{new Date(cacheTimestamp).toLocaleString()}</span>
                </div>
              )}

              {/* Factory Info Card */}
              <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30 col-span-1 md:col-span-2 lg:col-span-4">
                <div className="flex items-center gap-3 mb-4">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <span className="text-gray-400 text-lg">Protokol Bilgileri</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                  <div className="bg-gray-800/50 p-3 rounded-lg">
                    <span className="block text-gray-400 mb-1">Toplam Likidite Havuzu</span>
                    <span className="font-mono text-white/90 text-lg">{factoryInfo.totalPairs}</span>
                  </div>
                  <div className="bg-gray-800/50 p-3 rounded-lg">
                    <span className="block text-gray-400 mb-1">Protokol Komisyonu</span>
                    <span className={`font-medium ${factoryInfo.protocolFeeStatus === 'Açık' ? 'text-green-400' : 'text-red-400'}`}>
                      {factoryInfo.protocolFeeStatus}
                    </span>
                  </div>
                  <div className="bg-gray-800/50 p-3 rounded-lg">
                    <span className="block text-gray-400 mb-1">Komisyon Alıcısı (feeTo)</span>
                    <span className="font-mono text-white/90 break-all">{factoryInfo.feeTo}</span>
                  </div>
                  <div className="bg-gray-800/50 p-3 rounded-lg">
                    <span className="block text-gray-400 mb-1">Yetkili Adres (feeToSetter)</span>
                    <span className="font-mono text-white/90 break-all">{factoryInfo.feeToSetter}</span>
                  </div>
                  <div className="bg-gray-800/50 p-3 rounded-lg md:col-span-1 lg:col-span-1">
                    <span className="block text-gray-400 mb-1">Factory Kontratı</span>
                    <span className="font-mono text-white/90 break-all">{FACTORY_ADDRESS}</span>
                  </div>
                  <div className="bg-gray-800/50 p-3 rounded-lg md:col-span-1 lg:col-span-1">
                    <span className="block text-gray-400 mb-1">Router Kontratı</span>
                    <span className="font-mono text-white/90 break-all">{ROUTER_ADDRESS}</span>
                  </div>
                </div>
              </div>

              {/* Tracked Assets Summary */}
              {trackedBalances.length > 0 && (
                <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30 col-span-1 lg:col-span-4">
                  <div className="flex items-center gap-3 mb-4">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <span className="text-gray-400 text-lg">Takip Edilen Varlıklar</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {trackedBalances.map(token => (
                      <div key={token.address} className="bg-gray-800/50 px-4 py-3 rounded-lg border border-gray-700/30 flex justify-between items-center hover:border-blue-500/30 transition-all duration-300">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-600/20 flex items-center justify-center border border-gray-700/30">
                            <span className="font-bold text-white/90">{token.symbol.charAt(0)}</span>
                          </div>
                          <div>
                            <span className="font-medium text-white/90 block">{token.symbol}</span>
                            <span className="text-xs text-gray-400">{token.address.slice(0, 6)}...{token.address.slice(-4)}</span>
                          </div>
                        </div>
                        <span className="font-mono text-green-400 text-lg">{formatToDecimals(parseFloat(token.balance))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Hata Mesajları */}
      {(error || txError) && (
        <div className="w-full max-w-7xl mt-4 animate-fade-in">
          <div className="bg-red-900/20 backdrop-blur-sm border border-red-500/50 rounded-2xl p-6 flex items-center gap-4">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-red-400 flex-grow">{error || txError}</p>
            <button
              onClick={() => { setError(null); setTxError(null); }}
              className="text-red-400 hover:text-red-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 w-full max-w-8xl">
        {isLoading && (
          <div className="bg-blue-900/20 backdrop-blur-sm border border-blue-500/50 rounded-2xl p-6 mb-8 animate-fade-in">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <div className="flex-grow">
                <p className="text-blue-400 text-lg">{infoMessage}</p>
                <div className="w-full h-1 bg-blue-900/50 rounded-full mt-3 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full animate-pulse"
                    style={{ width: '50%' }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filtreleme */}
        <div className="mb-8 bg-gray-800/80 backdrop-blur-sm p-6 rounded-2xl shadow-xl border border-gray-700/50">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-blue-400"></div>
            <h2 className="text-lg font-semibold text-white">Filtrele ve Sırala</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Token/Adres Ara</label>
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Token sembolü veya adres..."
                  className="w-full px-4 py-3 bg-gray-900/50 rounded-xl border border-gray-700/30 focus:border-blue-500/50 focus:outline-none transition-colors pl-10"
                />
                <svg
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Minimum Değer ({targetTokenSymbol})</label>
              <div className="relative">
                <input
                  type="number"
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  placeholder="Min değer..."
                  className="w-full px-4 py-3 bg-gray-900/50 rounded-xl border border-gray-700/30 focus:border-blue-500/50 focus:outline-none transition-colors pl-10"
                />
                <svg
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4M4 12l6-6m-6 6l6 6" />
                </svg>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Maksimum Değer ({targetTokenSymbol})</label>
              <div className="relative">
                <input
                  type="number"
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  placeholder="Max değer..."
                  className="w-full px-4 py-3 bg-gray-900/50 rounded-xl border border-gray-700/30 focus:border-blue-500/50 focus:outline-none transition-colors pl-10"
                />
                <svg
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16m-6-6l6 6-6 6" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4  gap-4">
          {filteredAndSortedPositions.map((pos) => (
            <div key={pos.pairAddress} className="bg-gray-800/80 backdrop-blur-sm p-6 rounded-2xl shadow-xl border border-gray-700/50 flex flex-col group hover:border-blue-500/30 transition-all duration-300">
              <div className="flex-grow space-y-2">
                {/* Header */}
                <div className="space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 text-transparent bg-clip-text max-w-2xs truncate">
                        {pos.token0.symbol}/{pos.token1.symbol}
                      </h3>
                      <p className="text-xs text-gray-400 font-mono mt-1">
                        {`${pos.pairAddress.slice(0, 6)}...${pos.pairAddress.slice(-4)}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-2">
                        <span className="block text-2xl font-bold text-green-400">
                          {formatToDecimals(Number(pos.totalValueUSD))}
                        </span>
                        <span className="text-sm text-green-500">{targetTokenSymbol}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Token Details */}
                <div className="space-y-4">
                  {/* Token 0 */}
                  <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-gray-300 font-medium">{pos.token0.symbol}</span>
                      <span className="font-mono text-white">{formatToDecimals(Number(pos.token0.value))}</span>
                    </div>
                    {renderRoute(pos.token0.route) && (
                      <div className="text-xs text-gray-500 bg-gray-800/50 px-3 py-1.5 rounded-lg">
                        {renderRoute(pos.token0.route)}
                      </div>
                    )}
                  </div>

                  {/* Token 1 */}
                  <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-gray-300 font-medium">{pos.token1.symbol}</span>
                      <span className="font-mono text-white">{formatToDecimals(Number(pos.token1.value))}</span>
                    </div>
                    {renderRoute(pos.token1.route) && (
                      <div className="text-xs text-gray-500 bg-gray-800/50 px-3 py-1.5 rounded-lg">
                        {renderRoute(pos.token1.route)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Pool Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30">
                    <span className="block text-sm text-gray-400 mb-1">LP Bakiyesi</span>
                    <span className="font-mono text-white">{formatToDecimals(Number(pos.lpBalance))}</span>
                  </div>
                  <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30">
                    <span className="block text-sm text-gray-400 mb-1">Havuz Payı</span>
                    <span className="font-mono text-white">{Number(pos.poolShare).toFixed(2)}%</span>
                  </div>
                </div>

                {/* Estimated Returns */}
                {(isEstimating.has(pos.pairAddress) || estimatedTargetTokenValues.has(pos.pairAddress)) && (
                  <div className="bg-blue-900/20 rounded-xl p-4 border border-blue-500/20">
                    {isEstimating.has(pos.pairAddress) ? (
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        <p className="text-blue-400">Hesaplanıyor...</p>
                      </div>
                    ) : (
                      estimatedTargetTokenValues.get(pos.pairAddress) && (
                        <div className="space-y-2">
                          <p className="text-blue-400 font-medium">Tahmini Getiri (%{withdrawPercentages[pos.pairAddress] || 0})</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-gray-900/30 rounded-lg p-2">
                              <span className="block text-xs text-gray-400">{pos.token0.symbol}</span>
                              <span className="text-sm font-mono text-white">
                                {formatToDecimals(parseFloat(estimatedTargetTokenValues.get(pos.pairAddress)!.token0))} {targetTokenSymbol}
                              </span>
                            </div>
                            <div className="bg-gray-900/30 rounded-lg p-2">
                              <span className="block text-xs text-gray-400">{pos.token1.symbol}</span>
                              <span className="text-sm font-mono text-white">
                                {formatToDecimals(parseFloat(estimatedTargetTokenValues.get(pos.pairAddress)!.token1))} {targetTokenSymbol}
                              </span>
                            </div>
                          </div>
                          <div className="bg-blue-500/10 rounded-lg p-2 mt-2">
                            <span className="block text-xs text-blue-400">Toplam</span>
                            <span className="text-sm font-mono text-blue-300">
                              ≈ {formatToDecimals(parseFloat(estimatedTargetTokenValues.get(pos.pairAddress)!.total))} {targetTokenSymbol}
                            </span>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>

              {/* Withdraw Controls */}
              <div className="mt-6 pt-4 border-t border-gray-700/30">
                <div className="flex gap-3 mb-4">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={withdrawPercentages[pos.pairAddress] || ''}
                    onChange={(e) => setWithdrawPercentages(prev => ({ ...prev, [pos.pairAddress]: parseInt(e.target.value, 10) || 0 }))}
                    className="flex-1 px-4 py-3 bg-gray-900/50 rounded-xl border border-gray-700/30 focus:border-blue-500/50 focus:outline-none transition-colors"
                    placeholder="Yüzde girin..."
                  />
                  <button
                    onClick={() => handleWithdraw(pos, withdrawPercentages[pos.pairAddress] || 100)}
                    disabled={txStatus[pos.pairAddress] === 'pending'}
                    className="flex-1 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-medium py-3 px-6 rounded-xl disabled:from-gray-600 disabled:to-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg"
                  >
                    {txStatus[pos.pairAddress] === 'pending' ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Çekiliyor...</span>
                      </div>
                    ) : (
                      `Çek (%${withdrawPercentages[pos.pairAddress] || '100'})`
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}