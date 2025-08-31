"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ethers } from 'ethers';
import FactoryABI from '@/abis/SomniaExchangeFactory.json';
import PairABI from '@/abis/SomniaExchangePair.json';
import ERC20ABI from '@/abis/IERC20.json';
import RouterABI from '@/abis/SomniaExchangeRouter.json';
import { formatToDecimals } from '../../format';
import { getBestAmountOut } from '@/lib/pathfinder';

// Arayüz için veri tipleri
interface LpPosition {
  pairAddress: string;
  token0: { address: string; symbol: string; value: string; route?: string[]; };
  token1: { address: string; symbol: string; value: string; route?: string[]; };
  lpBalance: string;
  poolShare: string;
  totalValueUSD: string;
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
  const [cacheKey, setCacheKey] = useState<string>('');
  const [signerAddress, setSignerAddress] = useState<string>('');
  const [txStatus, setTxStatus] = useState<{ [pairAddress: string]: string }>({});
  const [txError, setTxError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [minValue, setMinValue] = useState<string>('');
  const [maxValue, setMaxValue] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('value');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [filterTokenAddress, setFilterTokenAddress] = useState<string>('');
  const [withdrawPercentages, setWithdrawPercentages] = useState<{ [pairAddress: string]: number }>({});
  const [bulkWithdrawPercentage, setBulkWithdrawPercentage] = useState<number>(100);
  const [directWithdrawPairAddress, setDirectWithdrawPairAddress] = useState<string>('');
  const [directWithdrawPercentage, setDirectWithdrawPercentage] = useState<number>(100);
  const [directWithdrawStatus, setDirectWithdrawStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [directWithdrawError, setDirectWithdrawError] = useState<string | null>(null);
  const [estimatedWsttValues, setEstimatedWsttValues] = useState<Map<string, { token0: string, token1: string, total: string }>>(new Map());
  const [isEstimating, setIsEstimating] = useState<Set<string>>(new Set());
  const [tokenSymbolMap, setTokenSymbolMap] = useState<Map<string, string>>(() => {
    if (typeof window === 'undefined') {
      return new Map();
    }
    const cached = localStorage.getItem('tokenSymbolMapCache');
    return cached ? new Map(JSON.parse(cached)) : new Map();
  });
  const [refreshingPosition, setRefreshingPosition] = useState<string | null>(null);

  useEffect(() => {
    // tokenSymbolMap her değiştiğinde localStorage'a kaydet
    if (tokenSymbolMap.size > 0) {
      localStorage.setItem('tokenSymbolMapCache', JSON.stringify(Array.from(tokenSymbolMap.entries())));
    }
  }, [tokenSymbolMap]);

  const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;
  const ROUTER_ADDRESS = process.env.NEXT_PUBLIC_ROUTER_ADDRESS!;
  const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS!;
  const WSTT_ADDRESS = process.env.NEXT_PUBLIC_WSTT_ADDRESS!;
  const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS!;
  const WALLET_TO_CHECK = process.env.NEXT_PUBLIC_WALLET_ADDRESS!;

  const provider = useMemo(() => new ethers.JsonRpcProvider(RPC_URL), [RPC_URL]);

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
          } catch (e) {
            // Sembol alınamazsa adresi kısaltarak ekle
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

  const fetchLpPositions = async (forceRefresh = false, filterToken: string | null = null) => {
    setIsLoading(true);
    setError(null);
    setTxError(null);

    if (!WALLET_TO_CHECK) {
      setError('.env dosyasında NEXT_PUBLIC_WALLET_ADDRESS bulunamadı.');
      setIsLoading(false);
      return;
    }

    const walletAddress = WALLET_TO_CHECK;
    setSignerAddress(walletAddress);
    const currentCacheKey = `${CACHE_KEY_PREFIX}${walletAddress}`;
    setCacheKey(currentCacheKey);

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
        setTotalPortfolioValue(previouslyFoundPositions.reduce((sum: number, pos: LpPosition) => sum + parseFloat(pos.totalValueUSD), 0));
        setCacheTimestamp(parsed.timestamp);

        if (parsed.lastScannedIndex + 1 >= parsed.totalPairCount) {
          setInfoMessage('Önbellekten yüklendi.');
          setIsLoading(false);
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
      const router = new ethers.Contract(ROUTER_ADDRESS, RouterABI.abi, provider);
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
        } catch (e) {
          decimalsCache.set(address, 18); return 18;
        }
      };

      const priceCacheSimple = new Map<string, { price: string, route: string[] }>();
      const getTokenPriceSimple = async (tokenAddress: string): Promise<{ price: string, route: string[] }> => {
        const address = tokenAddress.toLowerCase();
        if (address === WSTT_ADDRESS.toLowerCase()) return { price: '1.0', route: [WSTT_ADDRESS] };
        if (priceCacheSimple.has(address)) return priceCacheSimple.get(address)!;

        try {
          const tokenInDecimals = await getDecimals(tokenAddress);
          const amountIn = ethers.parseUnits('1', tokenInDecimals);

          const { amount: bestAmountOut, path: bestPath } = await getBestAmountOut(
            tokenAddress,
            WSTT_ADDRESS,
            amountIn,
            ROUTER_ADDRESS,
            FACTORY_ADDRESS,
            provider
          );

          if (bestAmountOut === 0n) {
            const result = { price: '0', route: [] };
            priceCacheSimple.set(address, result);
            return result;
          }
          const wsttDecimals = await getDecimals(WSTT_ADDRESS);
          const priceString = ethers.formatUnits(bestAmountOut, wsttDecimals);
          const result = { price: priceString, route: bestPath };
          priceCacheSimple.set(address, result);
          return result;
        } catch (error) {
          console.error(`[priceService] Failed to get price for ${tokenAddress} in WSTT:`, error);
          return { price: '0', route: [] };
        }
      };

      const pairCount = await factory.allPairsLength();
      const pairsToScan = Number(pairCount);
      if (initialScanIndex === 0) {
        setInfoMessage(`Toplam ${pairsToScan} çift taranıyor...`);
      }
      let foundPositions: LpPosition[] = [...previouslyFoundPositions];
      const BATCH_SIZE = 100;
      const localTokenSymbolMap = new Map();

      for (let i = initialScanIndex; i < pairsToScan; i += BATCH_SIZE) {
        const batchEnd = Math.min(i + BATCH_SIZE, pairsToScan);
        setInfoMessage(`Çiftler ${i + 1}-${batchEnd}/${pairsToScan} taranıyor...`);
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
              const token0Contract = new ethers.Contract(token0Address, ERC20ABI.abi, provider);
              const token1Contract = new ethers.Contract(token1Address, ERC20ABI.abi, provider);
              const [token0Symbol, token1Symbol] = await Promise.all([
                token0Contract.symbol().catch(() => '???'), token1Contract.symbol().catch(() => '???')
              ]);
              localTokenSymbolMap.set(token0Address.toLowerCase(), token0Symbol);
              localTokenSymbolMap.set(token1Address.toLowerCase(), token1Symbol);

              if (BigInt(totalSupply) === 0n) return null;

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
              const positionValueUSD = (reliableTotalPoolTvl * bn_balance) / bn_totalSupply;
              const valueOfEachTokenInUSD = positionValueUSD / 2n;
              let token0DerivedAmount = (token0Price > 0n) ? (valueOfEachTokenInUSD * (bn_ten ** BigInt(token0Decimals))) / token0Price : 0n;
              let token1DerivedAmount = (token1Price > 0n) ? (valueOfEachTokenInUSD * (bn_ten ** BigInt(token1Decimals))) / token1Price : 0n;

              const position: LpPosition = {
                pairAddress,
                token0: { address: token0Address, symbol: token0Symbol, value: ethers.formatUnits(token0DerivedAmount, token0Decimals), route: price0Result.route },
                token1: { address: token1Address, symbol: token1Symbol, value: ethers.formatUnits(token1DerivedAmount, token1Decimals), route: price1Result.route },
                lpBalance: ethers.formatEther(balance),
                poolShare: (Number((bn_balance * 10000n) / bn_totalSupply) / 100).toFixed(4),
                totalValueUSD: ethers.formatUnits(positionValueUSD, PRICE_PRECISION),
              };
              return position;
            } catch (e) { return null; }
          });
          const newPositions = (await Promise.all(positionPromises)).filter((p): p is LpPosition => p !== null);
          if (newPositions.length > 0) {
            foundPositions.push(...newPositions);
            const sorted = [...foundPositions].sort((a, b) => parseFloat(b.totalValueUSD) - parseFloat(a.totalValueUSD));
            setPositions(sorted);
            setTotalPortfolioValue(sorted.reduce((sum, pos) => sum + parseFloat(pos.totalValueUSD), 0));
          }
        }
        const currentProgress: CacheData = {
          timestamp: Date.now(),
          data: foundPositions,
          lastScannedIndex: batchEnd - 1,
          totalPairCount: pairsToScan,
        };
        localStorage.setItem(currentCacheKey, JSON.stringify(currentProgress));
        setCacheTimestamp(currentProgress.timestamp);
      }
      setTokenSymbolMap(localTokenSymbolMap);
      setInfoMessage('Tarama tamamlandı.');
    } catch (err: any) {
      console.error('Veri yükleme hatası:', err);
      setError(err.message || 'Veri alınırken bir hata oluştu.');
      setInfoMessage('Hata oluştu.');
    } finally {
      setIsLoading(false);
    }
  };

  const updateSinglePosition = useCallback(async (pairAddress: string) => {
    setRefreshingPosition(pairAddress);
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const pairContract = new ethers.Contract(pairAddress, PairABI.abi, provider);

      const [
        token0Address,
        token1Address,
        reserves,
        totalSupply,
        balance
      ] = await Promise.all([
        pairContract.token0(),
        pairContract.token1(),
        pairContract.getReserves(),
        pairContract.totalSupply(),
        pairContract.balanceOf(WALLET_TO_CHECK)
      ]);

      if (BigInt(balance) === 0n) {
        setPositions(prev => prev.filter(p => p.pairAddress.toLowerCase() !== pairAddress.toLowerCase()));
        return;
      }

      const token0Contract = new ethers.Contract(token0Address, ERC20ABI.abi, provider);
      const token1Contract = new ethers.Contract(token1Address, ERC20ABI.abi, provider);
      const [token0Symbol, token1Symbol] = await Promise.all([
        token0Contract.symbol().catch(() => '???'),
        token1Contract.symbol().catch(() => '???')
      ]);

      const PRICE_PRECISION = 30;
      const decimalsCache = new Map<string, number>();
      const getDecimals = async (tokenAddress: string): Promise<number> => {
        if (decimalsCache.has(tokenAddress)) return decimalsCache.get(tokenAddress)!;
        const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI.abi, provider);
        const decimals = await tokenContract.decimals();
        const num = Number(decimals);
        decimalsCache.set(tokenAddress, num);
        return num;
      };

      const getTokenPriceSimple = async (tokenAddress: string): Promise<{ price: string, route: string[] }> => {
        try {
          const tokenInDecimals = await getDecimals(tokenAddress);
          const amountIn = ethers.parseUnits('1', tokenInDecimals);

          const { amount: bestAmountOut, path: bestPath } = await getBestAmountOut(
            tokenAddress,
            WSTT_ADDRESS,
            amountIn,
            ROUTER_ADDRESS,
            FACTORY_ADDRESS,
            provider
          );

          if (bestAmountOut === 0n) {
            return { price: '0', route: [] };
          }
          const wsttDecimals = await getDecimals(WSTT_ADDRESS);
          const priceString = ethers.formatUnits(bestAmountOut, wsttDecimals);
          return { price: priceString, route: bestPath };
        } catch (error) {
          console.error(`[updateSinglePosition] Fiyat alınamadı ${tokenAddress}:`, error);
          return { price: '0', route: [] };
        }
      };

      const [price0Result, price1Result] = await Promise.all([
        getTokenPriceSimple(token0Address),
        getTokenPriceSimple(token1Address)
      ]);

      const token0Price = ethers.parseUnits(price0Result.price, PRICE_PRECISION);
      const token1Price = ethers.parseUnits(price1Result.price, PRICE_PRECISION);
      const [token0Decimals, token1Decimals] = await Promise.all([getDecimals(token0Address), getDecimals(token1Address)]);

      const bn_balance = BigInt(balance);
      const bn_totalSupply = BigInt(totalSupply);
      const bn_reserves0 = BigInt(reserves[0]);
      const bn_reserves1 = BigInt(reserves[1]);
      const bn_ten = 10n;

      const poolTvl0 = (bn_reserves0 * token0Price) / (bn_ten ** BigInt(token0Decimals));
      const poolTvl1 = (bn_reserves1 * token1Price) / (bn_ten ** BigInt(token1Decimals));
      const reliableTotalPoolTvl = poolTvl0 < poolTvl1 ? poolTvl0 * 2n : poolTvl1 * 2n;
      const positionValueUSD = (reliableTotalPoolTvl * bn_balance) / bn_totalSupply;
      const valueOfEachTokenInUSD = positionValueUSD / 2n;
      let token0DerivedAmount = (token0Price > 0n) ? (valueOfEachTokenInUSD * (bn_ten ** BigInt(token0Decimals))) / token0Price : 0n;
      let token1DerivedAmount = (token1Price > 0n) ? (valueOfEachTokenInUSD * (bn_ten ** BigInt(token1Decimals))) / token1Price : 0n;

      const updatedPosition: LpPosition = {
        pairAddress,
        token0: { address: token0Address, symbol: token0Symbol, value: ethers.formatUnits(token0DerivedAmount, token0Decimals) },
        token1: { address: token1Address, symbol: token1Symbol, value: ethers.formatUnits(token1DerivedAmount, token1Decimals) },
        lpBalance: ethers.formatEther(balance),
        poolShare: (Number((bn_balance * 10000n) / bn_totalSupply) / 100).toFixed(4),
        totalValueUSD: ethers.formatUnits(positionValueUSD, PRICE_PRECISION),
      };

      setPositions(prev => {
        const index = prev.findIndex(p => p.pairAddress.toLowerCase() === pairAddress.toLowerCase());
        if (index !== -1) {
          const newPositions = [...prev];
          newPositions[index] = updatedPosition;
          return newPositions;
        }
        return [...prev, updatedPosition];
      });

    } catch (error) {
      console.error(`Failed to update position ${pairAddress}:`, error);
    } finally {
      setRefreshingPosition(null);
    }
  }, [WALLET_TO_CHECK, RPC_URL, ROUTER_ADDRESS, FACTORY_ADDRESS, WSTT_ADDRESS]);

  useEffect(() => {
    const walletAddress = process.env.NEXT_PUBLIC_WALLET_ADDRESS;
    if (walletAddress) {
      fetchLpPositions(false, null);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setFilterTokenAddress('');
    fetchLpPositions(true, null);
  }, []);

  const handleFilterByToken = useCallback(() => {
    if (!ethers.isAddress(filterTokenAddress)) {
      setError("Lütfen geçerli bir token adresi girin.");
      return;
    }
    fetchLpPositions(true, filterTokenAddress);
  }, [filterTokenAddress]);

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
    if (minValue) {
      filtered = filtered.filter(pos => parseFloat(pos.totalValueUSD) >= parseFloat(minValue));
    }
    if (maxValue) {
      filtered = filtered.filter(pos => parseFloat(pos.totalValueUSD) <= parseFloat(maxValue));
    }
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'value':
          comparison = parseFloat(b.totalValueUSD) - parseFloat(a.totalValueUSD);
          break;
        case 'share':
          comparison = parseFloat(b.poolShare) - parseFloat(a.poolShare);
          break;
        case 'pair':
          comparison = `${a.token0.symbol}/${a.token1.symbol}`.localeCompare(`${b.token0.symbol}/${b.token1.symbol}`);
          break;
      }
      return sortOrder === 'asc' ? -comparison : comparison;
    });
    return filtered;
  }, [positions, searchTerm, minValue, maxValue, sortBy, sortOrder]);

  const handleWithdraw = useCallback(async (position: LpPosition, percentage: number) => {
    if (percentage <= 0 || percentage > 100) {
      setTxError("Geçersiz yüzde değeri.");
      return;
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
          totalValueUSD: parseFloat(position.totalValueUSD)
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'İşlem başarısız oldu.');
      }
      setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'success' }));
      await updateSinglePosition(position.pairAddress);
      setTimeout(() => {
        setTxStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[position.pairAddress];
          return newStatus;
        });
      }, 3000);
    } catch (error: any) {
      console.error("Withdraw error:", error);
      setTxError(error.message);
      setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'error' }));
      setTimeout(() => {
        setTxStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[position.pairAddress];
          return newStatus;
        });
        setTxError(null);
      }, 5000);
    }
  }, [updateSinglePosition]);

  const handleDirectWithdraw = useCallback(async () => {
    if (!ethers.isAddress(directWithdrawPairAddress)) {
      setDirectWithdrawError("Lütfen geçerli bir çift adresi (pair address) girin.");
      setDirectWithdrawStatus('error');
      return;
    }
    if (directWithdrawPercentage <= 0 || directWithdrawPercentage > 100) {
      setDirectWithdrawError("Geçersiz yüzde değeri. 1 ile 100 arasında olmalıdır.");
      setDirectWithdrawStatus('error');
      return;
    }
    setDirectWithdrawStatus('pending');
    setDirectWithdrawError(null);
    try {
      const pairContract = new ethers.Contract(directWithdrawPairAddress, PairABI.abi, provider);
      const [token0Address, token1Address] = await Promise.all([
        pairContract.token0(),
        pairContract.token1()
      ]);
      const response = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairAddress: directWithdrawPairAddress,
          token0Address: token0Address,
          token1Address: token1Address,
          percentage: directWithdrawPercentage,
          totalValueUSD: 0
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'İşlem başarısız oldu.');
      }
      setDirectWithdrawStatus('success');
      if (positions.some(p => p.pairAddress.toLowerCase() === directWithdrawPairAddress.toLowerCase())) {
        await updateSinglePosition(directWithdrawPairAddress);
      }
      setTimeout(() => setDirectWithdrawStatus('idle'), 3000);
    } catch (error: any) {
      console.error("Direct withdraw error:", error);
      setDirectWithdrawError(error.message);
      setDirectWithdrawStatus('error');
      setTimeout(() => {
        setDirectWithdrawStatus('idle');
        setDirectWithdrawError(null);
      }, 5000);
    }
  }, [directWithdrawPairAddress, directWithdrawPercentage, positions, updateSinglePosition]);

  useEffect(() => {
    const estimateWithdrawValue = async () => {
      const positionsToEstimate = positions.filter(p => (withdrawPercentages[p.pairAddress] || 0) > 0);

      if (positionsToEstimate.length === 0) {
        if (estimatedWsttValues.size > 0) setEstimatedWsttValues(new Map());
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
        } catch (e) {
          decimalsCache.set(address, 18); return 18;
        }
      };

      const newEstimates = new Map(estimatedWsttValues);

      await Promise.all(
        positionsToEstimate.map(async (pos) => {
          const percentage = withdrawPercentages[pos.pairAddress];
          if (!percentage) return;

          try {
            const calculateTokenWstt = async (token: { address: string, value: string }) => {
              if (parseFloat(token.value) === 0) return '0.0';

              const tokenDecimals = await getDecimals(token.address);
              const totalAmount = ethers.parseUnits(token.value, tokenDecimals);
              const amountToWithdraw = (totalAmount * BigInt(percentage)) / 100n;

              if (amountToWithdraw === 0n) return '0.0';

              if (token.address.toLowerCase() === WSTT_ADDRESS.toLowerCase()) {
                const wsttDecimals = await getDecimals(WSTT_ADDRESS);
                return ethers.formatUnits(amountToWithdraw, wsttDecimals);
              }

              const { amount: bestAmountOut } = await getBestAmountOut(
                token.address,
                WSTT_ADDRESS,
                amountToWithdraw,
                ROUTER_ADDRESS,
                FACTORY_ADDRESS,
                provider
              );

              const wsttDecimals = await getDecimals(WSTT_ADDRESS);
              return ethers.formatUnits(bestAmountOut, wsttDecimals);
            };

            const [wstt0, wstt1] = await Promise.all([
              calculateTokenWstt(pos.token0),
              calculateTokenWstt(pos.token1)
            ]);

            const totalWstt = parseFloat(wstt0) + parseFloat(wstt1);

            newEstimates.set(pos.pairAddress, {
              token0: wstt0,
              token1: wstt1,
              total: totalWstt.toFixed(6)
            });

          } catch (e) {
            console.error(`[Estimator] ${pos.pairAddress} için WSTT değeri hesaplanamadı:`, e);
            if (newEstimates.has(pos.pairAddress)) {
              newEstimates.delete(pos.pairAddress);
            }
          }
        })
      );

      setEstimatedWsttValues(new Map(newEstimates));
      setIsEstimating(new Set());
    };

    const debounceTimeout = setTimeout(() => {
      estimateWithdrawValue();
    }, 400);

    return () => clearTimeout(debounceTimeout);

  }, [withdrawPercentages, positions, provider, ROUTER_ADDRESS, FACTORY_ADDRESS, WSTT_ADDRESS]);


  const renderRoute = (route: string[] | undefined) => {
    if (!route || route.length === 0) return null;
    return route.map(addr => tokenSymbolMap.get(addr.toLowerCase()) || addr.slice(0, 6)).join(' → ');
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-12 bg-gray-900 text-white">
      <div className="z-10 w-full max-w-5xl">
        <div className="bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-700">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex-1">
              <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-500 text-transparent bg-clip-text">
                Somnia LP Dashboard
              </h1>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">Cüzdan:</span>
                  <span className="font-mono text-sm bg-gray-700/50 px-3 py-1 rounded-full">{signerAddress}</span>
                </div>
                {totalPortfolioValue > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">Toplam Varlık:</span>
                    <span className="text-2xl font-bold text-green-400">${formatToDecimals(totalPortfolioValue)}</span>
                  </div>
                )}
                {cacheTimestamp && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">Son Güncelleme:</span>
                    <span className="text-sm text-gray-300">{new Date(cacheTimestamp).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-gray-700/30 px-4 py-2 rounded-lg">
                <span className="text-gray-400">Durum:</span>
                <span className={`font-medium ${isLoading ? 'text-yellow-400' : 'text-green-400'}`}>
                  {isLoading ? 'Yükleniyor...' : 'Hazır'}
                </span>
              </div>
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold py-2 px-6 rounded-lg disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed transition-all duration-300 shadow-lg flex items-center gap-2"
              >
                <span>{isLoading ? 'Yükleniyor...' : 'Yenile'}</span>
                {!isLoading && <span className="text-lg">↻</span>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {(error || txError) && (
        <div className="w-full max-w-5xl mt-4">
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-red-500 text-xl">⚠</span>
              <div>
                {error && <p className="text-red-400">{error}</p>}
                {txError && <p className="text-red-400">İşlem Hatası: {txError}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 w-full max-w-8xl">
        {isLoading && (
          <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin text-blue-400 text-xl">↻</div>
              <p className="text-blue-400">{infoMessage}</p>
            </div>
          </div>
        )}

        {/* ... Filtreleme ve Toplu İşlemler ... */}
        <div className="mb-6 bg-gray-800 p-4 rounded-lg space-y-6">
          {/* Üst Satır Filtreler */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Token Adresine Göre Filtreleme */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Token Adresine Göre LP Getir</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={filterTokenAddress}
                  onChange={(e) => setFilterTokenAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 bg-gray-700 rounded text-white placeholder-gray-400"
                />
                <button
                  onClick={handleFilterByToken}
                  disabled={isLoading || !filterTokenAddress}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-500 disabled:cursor-not-allowed"
                >
                  Getir
                </button>
              </div>
            </div>

            {/* Arama Kutusu */}
            <div>
              <label className="block text-sm font-medium mb-1">Token/Adres Ara</label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Token sembolü veya adres..."
                className="w-full px-3 py-2 bg-gray-700 rounded text-white placeholder-gray-400"
              />
            </div>

            {/* Değer Aralığı */}
            <div>
              <label className="block text-sm font-medium mb-1">Minimum Değer ($)</label>
              <input
                type="number"
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
                placeholder="Min değer..."
                className="w-full px-3 py-2 bg-gray-700 rounded text-white placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Maksimum Değer ($)</label>
              <input
                type="number"
                value={maxValue}
                onChange={(e) => setMaxValue(e.target.value)}
                placeholder="Max değer..."
                className="w-full px-3 py-2 bg-gray-700 rounded text-white placeholder-gray-400"
              />
            </div>

            {/* Sıralama Seçenekleri */}
            <div>
              <label className="block text-sm font-medium mb-1">Sıralama</label>
              <div className="flex gap-2">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="flex-1 px-3 py-2 bg-gray-700 rounded text-white"
                >
                  <option value="value">Değer</option>
                  <option value="share">Havuz Payı</option>
                  <option value="pair">Token Çifti</option>
                </select>
                <button
                  onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600"
                >
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredAndSortedPositions.map((pos) => (
            <div key={pos.pairAddress} className="bg-gray-800 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 animate-fade-in relative border border-gray-700 flex flex-col">
              <div className="absolute top-4 right-4">
                <input
                  type="checkbox"
                  checked={selectedPositions.has(pos.pairAddress)}
                  onChange={(e) => {
                    const newSelected = new Set(selectedPositions);
                    if (e.target.checked) {
                      newSelected.add(pos.pairAddress);
                    } else {
                      newSelected.delete(pos.pairAddress);
                    }
                    setSelectedPositions(newSelected);
                  }}
                  className="w-5 h-5 accent-blue-500 cursor-pointer"
                />
              </div>

              <div className="flex-grow">
                <div className="flex justify-between items-start mt-2 mb-4">
                  <button
                    onClick={() => updateSinglePosition(pos.pairAddress)}
                    disabled={!!refreshingPosition}
                    className="absolute top-0 left-2 text-2xl text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span className={`text-3xl ${refreshingPosition === pos.pairAddress ? 'animate-spin' : ''}`}>
                      ↻
                    </span>
                  </button>
                  <div className="flex-1 flex items-center gap-2">
                    <div>
                      <h3 className="text-xl font-bold text-white mb-1">
                        {pos.token0.symbol}/{pos.token1.symbol}
                      </h3>
                      <p className="text-xs text-gray-400 font-mono break-all">{pos.pairAddress}</p>
                    </div>

                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-green-400">${formatToDecimals(Number(pos.totalValueUSD))}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-gray-700/50 p-3 rounded-lg">
                    <p className="text-sm text-gray-400">LP Miktarı</p>
                    <p className="text-lg font-semibold">{formatToDecimals(parseFloat(pos.lpBalance))}</p>
                  </div>
                  <div className="bg-gray-700/50 p-3 rounded-lg">
                    <p className="text-sm text-gray-400">Havuz Payı</p>
                    <p className="text-lg font-semibold">%{pos.poolShare}</p>
                  </div>
                </div>

                <div className="bg-gray-700/30 p-4 rounded-lg mb-4">
                  <p className="text-sm text-gray-400 mb-2">Token Değerleri ve Rotaları</p>
                  <div className="space-y-2">
                    {/* Token 0 */}
                    <div>
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{pos.token0.symbol}</span>
                        <span>{formatToDecimals(parseFloat(pos.token0.value))}</span>
                      </div>
                      <p className="text-xs text-gray-500 text-right">{renderRoute(pos.token0.route)}</p>
                    </div>
                    {/* Token 1 */}
                    <div>
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{pos.token1.symbol}</span>
                        <span>{formatToDecimals(parseFloat(pos.token1.value))}</span>
                      </div>
                      <p className="text-xs text-gray-500 text-right">{renderRoute(pos.token1.route)}</p>
                    </div>

                    {/* WSTT Tahmini */}
                    {(isEstimating.has(pos.pairAddress) || estimatedWsttValues.has(pos.pairAddress)) && (
                      <div className="pt-2 mt-2 border-t border-gray-600/50">
                        {isEstimating.has(pos.pairAddress) ? (
                          <p className="text-sm text-yellow-400 text-center animate-pulse">Hesaplanıyor...</p>
                        ) : (
                          estimatedWsttValues.get(pos.pairAddress) && (
                            <div>
                              <p className="text-sm text-gray-300 mb-1">
                                Tahmini WSTT Getirisi (%{withdrawPercentages[pos.pairAddress] || 0})
                              </p>
                              <div className="text-right space-y-1">
                                <p className="text-xs text-gray-400">
                                  {pos.token0.symbol}: {formatToDecimals(parseFloat(estimatedWsttValues.get(pos.pairAddress)!.token0))} WSTT
                                </p>
                                <p className="text-xs text-gray-400">
                                  {pos.token1.symbol}: {formatToDecimals(parseFloat(estimatedWsttValues.get(pos.pairAddress)!.token1))} WSTT
                                </p>
                                <p className="text-lg font-bold text-green-400">
                                  ≈ {formatToDecimals(parseFloat(estimatedWsttValues.get(pos.pairAddress)!.total))} WSTT
                                </p>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-auto">
                <div className="mb-4">
                  <p className="text-sm text-gray-400 mb-2">Çekim Oranı (%)</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={withdrawPercentages[pos.pairAddress] || ''}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        const clampedValue = Math.max(0, Math.min(100, isNaN(value) ? 0 : value));
                        setWithdrawPercentages(prev => ({ ...prev, [pos.pairAddress]: clampedValue }));
                      }}
                      placeholder="Örn: 2"
                      className="w-full px-3 py-2 bg-gray-700 rounded text-white placeholder-gray-400 disabled:bg-gray-800 disabled:cursor-not-allowed"
                      disabled={isLoading}
                    />
                    <div className="flex gap-1">
                      {[25, 50, 75, 100].map((p) => (
                        <button
                          key={p}
                          onClick={() => setWithdrawPercentages(prev => ({ ...prev, [pos.pairAddress]: p }))}
                          className={`px-3 py-2 rounded-lg text-xs font-bold transition-colors ${withdrawPercentages[pos.pairAddress] === p
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-600 hover:bg-gray-500 text-gray-300'
                            } disabled:bg-gray-800 disabled:cursor-not-allowed`}
                          disabled={isLoading}
                        >
                          {p}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <button
                    onClick={() => handleWithdraw(pos, withdrawPercentages[pos.pairAddress] || 100)}
                    disabled={txStatus[pos.pairAddress] === 'pending' || !withdrawPercentages[pos.pairAddress]}
                    className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-bold py-3 px-4 rounded-lg disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed transition-all duration-300 shadow-lg"
                  >
                    {txStatus[pos.pairAddress] === 'pending'
                      ? 'Çekiliyor...'
                      : `Çek (%${withdrawPercentages[pos.pairAddress] || ' Seçiniz'})`}
                  </button>
                  {txStatus[pos.pairAddress] === 'success' && (
                    <div className="flex items-center justify-center gap-2 mt-2">
                      <span className="text-green-400">✓</span>
                      <p className="text-green-400 text-sm">İşlem başarılı!</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {!isLoading && positions.length === 0 && !error && (
          <p className="mt-4">Bu cüzdana ait LP pozisyonu bulunamadı.</p>
        )}
      </div>
    </main>
  );
}