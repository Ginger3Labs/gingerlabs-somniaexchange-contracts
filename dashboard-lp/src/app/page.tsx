"use client";

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import FactoryABI from '@/abis/SomniaExchangeFactory.json';
import PairABI from '@/abis/SomniaExchangePair.json';
import ERC20ABI from '@/abis/IERC20.json';
import RouterABI from '@/abis/SomniaExchangeRouter.json';

// Arayüz için veri tipleri
interface LpPosition {
  pairAddress: string;
  token0: { address: string; symbol: string; value: string; };
  token1: { address: string; symbol: string; value: string; };
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

  // --- KONFIGURASYON ---
  const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://enterprise.onerpc.com/somnia_testnet?apikey=Ku3gV1hlxVE3wPUH5aeLC126NpZfO2Sg";
  const WALLET_TO_CHECK = "0xD8976d7D8F18e536827113dc3707c55f15FC8915"; // Bu, özel anahtarın adresiyle değiştirilecek
  const FACTORY_ADDRESS = "0x31015A978c5815EdE29D0F969a17e116BC1866B1";
  const ROUTER_ADDRESS = "0xb98c15a0dC1e271132e341250703c7e94c059e8D";
  const WSTT_ADDRESS = "0xF22eF0085f6511f70b01a68F360dCc56261F768a";
  const USDC_ADDRESS = "0xDa4FDE38bE7a2b959BF46E032ECfA21e64019b76";
  // --- BİTİŞ ---

  const fetchLpPositions = async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);
    setTxError(null);

    // .env.local kontrolü
    if (!process.env.NEXT_PUBLIC_TEMP_PK) {
      setError('Yapılandırma hatası: .env.local dosyasında NEXT_PUBLIC_TEMP_PK değişkeni bulunamadı. Lütfen dosyayı oluşturup sunucuyu yeniden başlatın.');
      setIsLoading(false);
      return;
    }

    const wallet = new ethers.Wallet(process.env.NEXT_PUBLIC_TEMP_PK);
    const walletAddress = wallet.address;
    setSignerAddress(walletAddress);

    const currentCacheKey = `${CACHE_KEY_PREFIX}${walletAddress}`;
    setCacheKey(currentCacheKey);

    let startFrom = 0;
    const cachedItem = localStorage.getItem(currentCacheKey);
    if (cachedItem && !forceRefresh) {
      try {
        const cachedData: CacheData = JSON.parse(cachedItem);
        startFrom = cachedData.lastScannedIndex + 1;
      } catch (e) {
        console.error("Önbellek okunurken hata oluştu, sıfırdan başlanıyor:", e);
        localStorage.removeItem(currentCacheKey);
      }
    }

    if (forceRefresh) {
      localStorage.removeItem(currentCacheKey);
      setPositions([]);
      setTotalPortfolioValue(0);
      startFrom = 0;
    }

    setInfoMessage('Blockchain ile bağlantı kuruluyor...');
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const factory = new ethers.Contract(FACTORY_ADDRESS, FactoryABI.abi, provider);

      // --- Fiyat Hesaplama Mantığı (v2 - Yönlendirme ile) ---
      const PRICE_PRECISION = 30; // BigInt hesaplamaları için yüksek hassasiyet
      const router = new ethers.Contract(ROUTER_ADDRESS, RouterABI.abi, provider);

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
          console.warn(`Could not fetch decimals for ${tokenAddress}, defaulting to 18.`);
          decimalsCache.set(address, 18); // Varsayılan
          return 18;
        }
      };

      const getBestAmountOut = async (tokenInAddress: string, tokenOutAddress: string, amountIn: bigint): Promise<bigint> => {
        const routes: string[][] = [
          [tokenInAddress, tokenOutAddress], // Direct route
          [tokenInAddress, WSTT_ADDRESS, tokenOutAddress] // Route via WSTT
        ];

        let bestAmountOut = 0n;

        for (const route of routes) {
          try {
            // Check if the pair exists for direct routes to avoid unnecessary RPC calls
            if (route.length === 2) {
              const pairAddress = await factory.getPair(route[0], route[1]);
              if (pairAddress === ethers.ZeroAddress) {
                continue; // Skip if pair doesn't exist
              }
            }
            const amountsOut = await router.getAmountsOut(amountIn, route);
            const currentAmountOut = amountsOut[amountsOut.length - 1];
            if (currentAmountOut > bestAmountOut) {
              bestAmountOut = currentAmountOut;
            }
          } catch (error) {
            // Silently ignore errors for routes that don't exist or have low liquidity
          }
        }
        return bestAmountOut;
      };

      const priceCache = new Map<string, string>();
      const getTokenPriceInUSDC = async (tokenAddress: string): Promise<string> => {
        const address = tokenAddress.toLowerCase();
        if (address === USDC_ADDRESS.toLowerCase()) return '1.0';
        if (priceCache.has(address)) return priceCache.get(address)!;

        try {
          const tokenInDecimals = await getDecimals(tokenAddress);
          const usdcDecimals = await getDecimals(USDC_ADDRESS);

          // 1 tam token birimi için hesapla
          const amountIn = ethers.parseUnits('1', tokenInDecimals);

          const bestAmountOut = await getBestAmountOut(tokenAddress, USDC_ADDRESS, amountIn);

          if (bestAmountOut === 0n) {
            priceCache.set(address, '0');
            return '0';
          }

          const priceString = ethers.formatUnits(bestAmountOut, usdcDecimals);
          priceCache.set(address, priceString);
          return priceString;

        } catch (error) {
          console.error(`[priceService] Failed to get price for ${tokenAddress}:`, error);
          priceCache.set(address, '0');
          return '0';
        }
      };
      // --- Fiyat Hesaplama Bitiş ---

      const pairCount = await factory.allPairsLength();
      const pairsToScan = Number(pairCount);
      const BATCH_SIZE = 25; // RPC limitlerini aşmamak için düşürüldü

      setInfoMessage(`Toplam ${pairsToScan} çift var, taramaya ${startFrom + 1}. çiftten devam ediliyor...`);

      for (let i = startFrom; i < pairsToScan; i += BATCH_SIZE) {
        const batchEnd = Math.min(i + BATCH_SIZE, pairsToScan);
        setInfoMessage(`Çiftler ${i + 1}-${batchEnd}/${pairsToScan} taranıyor...`);

        // 1. Adım: Gruptaki tüm çift adreslerini paralel olarak al
        const pairIndexPromises = [];
        for (let j = i; j < batchEnd; j++) {
          pairIndexPromises.push(factory.allPairs(j));
        }
        const pairAddresses = await Promise.all(pairIndexPromises);

        // 2. Adım: Gruptaki tüm çiftlerin LP bakiyelerini paralel olarak kontrol et
        const balancePromises = pairAddresses.map(pairAddress => {
          const pairContract = new ethers.Contract(pairAddress, PairABI.abi, provider);
          return pairContract.balanceOf(walletAddress).then(balance => ({ pairAddress, balance }));
        });

        const balances = await Promise.all(balancePromises);

        // 3. Adım: Sadece bakiyesi olan çiftleri filtrele
        const pairsWithBalance = balances.filter(({ balance }) => balance > 0);

        if (pairsWithBalance.length > 0) {
          // 4. Adım: Bakiyesi olan çiftlerin detaylarını paralel olarak al
          const positionPromises = pairsWithBalance.map(async ({ pairAddress, balance }) => {
            try {
              console.log(`İşleniyor: ${pairAddress}`); // Hata ayıklama için log eklendi
              const pairContract = new ethers.Contract(pairAddress, PairABI.abi, provider);
              const [token0Address, token1Address, reserves, totalSupply] = await Promise.all([
                pairContract.token0(),
                pairContract.token1(),
                pairContract.getReserves(),
                pairContract.totalSupply()
              ]);

              const token0Contract = new ethers.Contract(token0Address, ERC20ABI.abi, provider);
              const token1Contract = new ethers.Contract(token1Address, ERC20ABI.abi, provider);
              const [token0Symbol, token1Symbol] = await Promise.all([
                token0Contract.symbol().catch(() => '???'),
                token1Contract.symbol().catch(() => '???')
              ]);

              if (totalSupply === 0n) return null; // Prevent division by zero

              // Kullanıcının havuzdaki payını temsil eden token miktarları
              const token0Value = (BigInt(reserves[0]) * BigInt(balance)) / BigInt(totalSupply);
              const token1Value = (BigInt(reserves[1]) * BigInt(balance)) / BigInt(totalSupply);
              const poolShare = (balance * 10000n) / totalSupply;

              // Token ondalık basamaklarını al
              const [token0Decimals, token1Decimals] = await Promise.all([
                getDecimals(token0Address),
                getDecimals(token1Address)
              ]);

              // Token fiyatlarını USDC cinsinden al (string olarak)
              const [price0Str, price1Str] = await Promise.all([
                getTokenPriceInUSDC(token0Address),
                getTokenPriceInUSDC(token1Address)
              ]);

              // Fiyatları BigInt'e çevir
              const token0Price = ethers.parseUnits(price0Str, PRICE_PRECISION);
              const token1Price = ethers.parseUnits(price1Str, PRICE_PRECISION);

              // Pozisyonun her bir parçasının USD değerini hesapla
              // Değer = (token_miktarı * token_fiyatı_hassas) / (10 ** token_ondalık)
              const token0ValueUSD = (token0Value * token0Price) / (10n ** BigInt(token0Decimals));
              const token1ValueUSD = (token1Value * token1Price) / (10n ** BigInt(token1Decimals));
              const positionValueUSD = token0ValueUSD + token1ValueUSD;

              return {
                pairAddress,
                token0: { address: token0Address, symbol: token0Symbol, value: ethers.formatUnits(token0Value, token0Decimals) },
                token1: { address: token1Address, symbol: token1Symbol, value: ethers.formatUnits(token1Value, token1Decimals) },
                lpBalance: ethers.formatEther(balance),
                poolShare: (Number(poolShare) / 100).toFixed(2),
                totalValueUSD: ethers.formatUnits(positionValueUSD, PRICE_PRECISION),
              };
            } catch (e) {
              console.warn(`Pozisyon detayı alınırken hata oluştu (${pairAddress}):`, e);
              return null; // Hata durumunda null döndür
            }
          });

          const newPositionsData = (await Promise.all(positionPromises)).filter((p): p is LpPosition => p !== null);

          if (newPositionsData.length > 0) {
            setPositions(prevPositions => {
              const existingPairAddresses = new Set(prevPositions.map(p => p.pairAddress));
              const uniqueNewPositions = newPositionsData.filter(p => !existingPairAddresses.has(p.pairAddress));

              if (uniqueNewPositions.length === 0) {
                return prevPositions;
              }

              const allPositions = [...prevPositions, ...uniqueNewPositions].sort((a, b) => parseFloat(b.totalValueUSD) - parseFloat(a.totalValueUSD));
              const newTotalValue = allPositions.reduce((sum, pos) => sum + parseFloat(pos.totalValueUSD), 0);
              setTotalPortfolioValue(newTotalValue);
              return allPositions;
            });
          }
        }

        // 5. Adım: Her grubun sonunda önbelleği güncelle
        setPositions(currentPositions => {
          const cacheData: CacheData = {
            timestamp: Date.now(),
            lastScannedIndex: batchEnd - 1,
            totalPairCount: pairsToScan,
            data: currentPositions
          };
          localStorage.setItem(currentCacheKey, JSON.stringify(cacheData));
          setCacheTimestamp(cacheData.timestamp);
          return currentPositions;
        });
      }

      setInfoMessage('Tarama tamamlandı.');

    } catch (err: any) {
      setError(`Veri alınırken hata oluştu: ${err.message}`);
      setInfoMessage('Hata oluştu.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const pk = process.env.NEXT_PUBLIC_TEMP_PK;
    if (pk) {
      const wallet = new ethers.Wallet(pk);
      const key = `${CACHE_KEY_PREFIX}${wallet.address}`;

      const cachedItem = localStorage.getItem(key);
      if (cachedItem) {
        try {
          const cachedData: CacheData = JSON.parse(cachedItem);
          const sortedData = cachedData.data.sort((a, b) => parseFloat(b.totalValueUSD) - parseFloat(a.totalValueUSD));
          setPositions(sortedData);
          const totalValue = sortedData.reduce((sum, pos) => sum + parseFloat(pos.totalValueUSD), 0);
          setTotalPortfolioValue(totalValue);
          setCacheTimestamp(cachedData.timestamp);
        } catch (e) {
          console.error("Önbellek parse edilirken hata:", e);
          localStorage.removeItem(key);
        }
      }
      fetchLpPositions(false);
    }
  }, []);

  const handleRefresh = () => {
    fetchLpPositions(true);
  };

  const handleWithdraw = async (position: LpPosition) => {
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
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'İşlem başarısız oldu.');
      }

      setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'success' }));
      // Başarılı işlem sonrası listeyi yenile
      setTimeout(() => fetchLpPositions(true), 2000);

    } catch (error: any) {
      console.error("Withdraw error:", error);
      setTxError(error.message);
      setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'error' }));
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-12 bg-gray-900 text-white">
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold mb-2">Somnia LP Dashboard</h1>
            <p className="text-sm text-gray-400 break-all">İşlem Yapan Cüzdan: {signerAddress}</p>
            {totalPortfolioValue > 0 && (
              <p className="text-lg text-green-400 font-bold mt-2">
                Toplam Varlık: ${totalPortfolioValue.toFixed(2)}
              </p>
            )}
            {cacheTimestamp && (
              <p className="text-xs text-gray-500 mt-1">
                Veriler en son {new Date(cacheTimestamp).toLocaleString()} tarihinde güncellendi.
              </p>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-500 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Yükleniyor...' : 'Yenile'}
          </button>
        </div>
      </div>

      {error && <p className="text-red-500 mt-4">{error}</p>}
      {txError && <p className="text-red-500 mt-4">İşlem Hatası: {txError}</p>}

      <div className="mt-8 w-full max-w-5xl">
        {isLoading && <p>{infoMessage}</p>}

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {positions.map((pos) => (
            <div key={pos.pairAddress} className="bg-gray-800 p-4 rounded-lg shadow-md animate-fade-in">
              <div className="flex justify-between items-start">
                <h3 className="text-lg font-semibold break-all w-3/4">{pos.token0.symbol}/{pos.token1.symbol}</h3>
                <span className="text-xl font-bold text-green-500">${parseFloat(pos.totalValueUSD).toFixed(2)}</span>
              </div>
              <p className="text-xs text-gray-400 break-all mb-2">{pos.pairAddress}</p>
              <div className="mt-2 space-y-1 text-sm">
                <p><strong>LP Miktarı:</strong> {parseFloat(pos.lpBalance).toFixed(4)}</p>
                <p><strong>Havuz Payı:</strong> %{pos.poolShare}</p>
                <hr className="my-2 border-gray-600" />
                <p><strong>Token Değerleri:</strong></p>
                <p>{parseFloat(pos.token0.value).toFixed(4)} {pos.token0.symbol}</p>
                <p>{parseFloat(pos.token1.value).toFixed(4)} {pos.token1.symbol}</p>
              </div>
              <div className="mt-4">
                <button
                  onClick={() => handleWithdraw(pos)}
                  disabled={txStatus[pos.pairAddress] === 'pending' || isLoading}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-500 disabled:cursor-not-allowed"
                >
                  {txStatus[pos.pairAddress] === 'pending' ? 'Çekiliyor...' : 'Hepsini Çek (Withdraw)'}
                </button>
                {txStatus[pos.pairAddress] === 'success' && <p className="text-green-400 text-xs mt-1 text-center">İşlem başarılı!</p>}
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
