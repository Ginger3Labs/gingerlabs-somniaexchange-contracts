"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ethers } from 'ethers';
import FactoryABI from '@/abis/SomniaExchangeFactory.json';
import PairABI from '@/abis/SomniaExchangePair.json';
import ERC20ABI from '@/abis/IERC20.json';
import RouterABI from '@/abis/SomniaExchangeRouter.json';
import { formatToDecimals } from '../../format';

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
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [minValue, setMinValue] = useState<string>('');
  const [maxValue, setMaxValue] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('value'); // 'value', 'share', 'pair'
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [filterTokenAddress, setFilterTokenAddress] = useState<string>('');
  const [withdrawPercentages, setWithdrawPercentages] = useState<{ [pairAddress: string]: number }>({});
  const [bulkWithdrawPercentage, setBulkWithdrawPercentage] = useState<number>(100);
  const [directWithdrawPairAddress, setDirectWithdrawPairAddress] = useState<string>('');
  const [directWithdrawPercentage, setDirectWithdrawPercentage] = useState<number>(100);
  const [directWithdrawStatus, setDirectWithdrawStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [directWithdrawError, setDirectWithdrawError] = useState<string | null>(null);

  // --- KONFIGURASYON ---
  const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://enterprise.onerpc.com/somnia_testnet?apikey=Ku3gV1hlxVE3wPUH5aeLC126NpZfO2Sg";
  const WALLET_TO_CHECK = "0xD8976d7D8F18e536827113dc3707c55f15FC8915"; // Bu, özel anahtarın adresiyle değiştirilecek
  const FACTORY_ADDRESS = "0x31015A978c5815EdE29D0F969a17e116BC1866B1";
  const ROUTER_ADDRESS = "0xb98c15a0dC1e271132e341250703c7e94c059e8D";
  const WSTT_ADDRESS = "0xF22eF0085f6511f70b01a68F360dCc56261F768a";
  const USDC_ADDRESS = "0xDa4FDE38bE7a2b959BF46E032ECfA21e64019b76";
  // --- BİTİŞ ---

  const fetchLpPositions = async (forceRefresh = false, filterToken: string | null = null) => {
    setIsLoading(true);
    setError(null);
    setTxError(null);

    // Önbellek kontrolü
    if (!forceRefresh) {
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        const cacheAge = Date.now() - parsed.timestamp;
        // Önbellek 5 dakikadan yeni ise kullan
        if (cacheAge < 5 * 60 * 1000) {
          setPositions(parsed.data);
          const totalValue = parsed.data.reduce((sum: number, pos: LpPosition) => sum + parseFloat(pos.totalValueUSD), 0);
          setTotalPortfolioValue(totalValue);
          setCacheTimestamp(parsed.timestamp);
          setIsLoading(false);
          return;
        }
      }
    }

    // .env.local kontrolü
    if (!process.env.NEXT_PUBLIC_TEMP_PK) {
      throw new Error('Yapılandırma hatası: .env.local dosyasında NEXT_PUBLIC_TEMP_PK değişkeni bulunamadı. Lütfen dosyayı oluşturup sunucuyu yeniden başlatın.');
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
        // Rotaları, hedef token'a (WSTT) göre yeniden düzenle
        const routes: string[][] = [
          [tokenInAddress, tokenOutAddress], // Direkt Rota: TOKEN -> WSTT
          [tokenInAddress, USDC_ADDRESS, tokenOutAddress] // USDC Üzerinden Rota: TOKEN -> USDC -> WSTT
        ];

        let bestAmountOut = 0n;

        for (const route of routes) {
          try {
            if (route.length === 2) {
              const pairAddress = await factory.getPair(route[0], route[1]);
              if (pairAddress === ethers.ZeroAddress) continue;
            }
            const amountsOut = await router.getAmountsOut(amountIn, route);
            const currentAmountOut = amountsOut[amountsOut.length - 1];
            if (currentAmountOut > bestAmountOut) {
              bestAmountOut = currentAmountOut;
            }
          } catch (error) {
            // Hatalı veya likiditesiz rotaları sessizce atla
          }
        }
        return bestAmountOut;
      };

      const priceCache = new Map<string, string>();
      // Fonksiyonu, WSTT'yi referans alacak şekilde yeniden adlandır ve düzenle
      const getTokenPriceInWSTT = async (tokenAddress: string): Promise<string> => {
        const address = tokenAddress.toLowerCase();
        // Referans token WSTT olduğu için, kendi fiyatı her zaman 1.0'dır.
        if (address === WSTT_ADDRESS.toLowerCase()) return '1.0';
        if (priceCache.has(address)) return priceCache.get(address)!;

        try {
          const tokenInDecimals = await getDecimals(tokenAddress);
          const wsttDecimals = await getDecimals(WSTT_ADDRESS);

          const amountIn = ethers.parseUnits('1', tokenInDecimals);

          // Hedef token olarak WSTT_ADDRESS'i kullan
          const bestAmountOut = await getBestAmountOut(tokenAddress, WSTT_ADDRESS, amountIn);

          if (bestAmountOut === 0n) {
            priceCache.set(address, '0');
            return '0';
          }

          const priceString = ethers.formatUnits(bestAmountOut, wsttDecimals);

          const MAX_REASONABLE_PRICE = 1_000_000_000; // 1 Milyar WSTT
          if (Number(priceString) > MAX_REASONABLE_PRICE) {
            console.warn(`Fahiş fiyat tespit edildi (${tokenAddress}): ${priceString} WSTT. Fiyat 0 olarak kabul ediliyor.`);
            priceCache.set(address, '0');
            return '0';
          }

          priceCache.set(address, priceString);
          return priceString;

        } catch (error) {
          console.error(`[priceService] Failed to get price for ${tokenAddress} in WSTT:`, error);
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

        // 1. Adım: Gruptaki tüm çift adreslerini paralel olarak al (Hata toleranslı)
        const pairAddressPromises = [];
        for (let j = i; j < batchEnd; j++) {
          pairAddressPromises.push(
            factory.allPairs(j).catch(err => {
              console.warn(`Dizin ${j} için çift adresi alınamadı, atlanıyor. Hata:`, err.code);
              return null; // Hata durumunda null döndürerek Promise.all'un devam etmesini sağla
            })
          );
        }
        // Hatalı (null) veya boş adresleri filtreleyerek devam et
        let pairAddresses = (await Promise.all(pairAddressPromises)).filter((addr): addr is string => addr !== null && addr !== ethers.ZeroAddress);

        // Eğer bir filtre token adresi varsa, bu aşamada filtrele
        if (filterToken && ethers.isAddress(filterToken)) {
          const filterPromises = pairAddresses.map(async (pairAddress) => {
            try {
              const pairContract = new ethers.Contract(pairAddress, PairABI.abi, provider);
              const token0 = await pairContract.token0();
              const token1 = await pairContract.token1();
              if (token0.toLowerCase() === filterToken.toLowerCase() || token1.toLowerCase() === filterToken.toLowerCase()) {
                return pairAddress;
              }
              return null;
            } catch (e) {
              return null; // Hata durumunda atla
            }
          });
          pairAddresses = (await Promise.all(filterPromises)).filter((addr): addr is string => addr !== null);
        }

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

              if (BigInt(totalSupply) === 0n) return null; // Sıfıra bölmeyi engelle

              // Tüm ham değerleri BigInt'e çevir
              const bn_balance = BigInt(balance);
              const bn_totalSupply = BigInt(totalSupply);
              const bn_reserves0 = BigInt(reserves[0]);
              const bn_reserves1 = BigInt(reserves[1]);

              // Token ondalık basamaklarını ve GÜVENLİ fiyatlarını al
              const [token0Decimals, token1Decimals] = await Promise.all([
                getDecimals(token0Address),
                getDecimals(token1Address)
              ]);
              const [price0Str, price1Str] = await Promise.all([
                getTokenPriceInWSTT(token0Address), // USDC yerine WSTT bazlı fiyat fonksiyonunu çağır
                getTokenPriceInWSTT(token1Address)
              ]);

              // Fiyat string'lerini BigInt'e çevir
              const token0Price = ethers.parseUnits(price0Str, PRICE_PRECISION);
              const token1Price = ethers.parseUnits(price1Str, PRICE_PRECISION);

              // Havuz payını hesapla
              const poolShare = (bn_balance * 10000n) / bn_totalSupply;
              const bn_ten = 10n;

              // --- HATA AYIKLAMA LOGLARI ---
              console.log(` çifti için HESAPLAMA DETAYLARI`);
              console.log(`-----------------------------------`);
              console.log(`${token0Symbol} Fiyat (String):`, price0Str);
              console.log(`${token1Symbol} Fiyat (String):`, price1Str);
              console.log(`${token0Symbol} Fiyat (BigInt):`, token0Price.toString());
              console.log(`${token1Symbol} Fiyat (BigInt):`, token1Price.toString());
              console.log(`${token0Symbol} Ondalık:`, token0Decimals);
              console.log(`${token1Symbol} Ondalık:`, token1Decimals);
              console.log(`${token0Symbol} Rezerv:`, bn_reserves0.toString());
              console.log(`${token1Symbol} Rezerv:`, bn_reserves1.toString());
              // --- HATA AYIKLAMA LOGLARI BİTİŞ ---

              // Adım 1: Havuzun her iki tarafının da toplam USD değerini (TVL) hesapla
              const poolTvl0 = (bn_reserves0 * token0Price) / (bn_ten ** BigInt(token0Decimals));
              const poolTvl1 = (bn_reserves1 * token1Price) / (bn_ten ** BigInt(token1Decimals));

              // Adım 2: Havuzun GÜVENİLİR toplam değerini, düşük değerli tarafı baz alarak hesapla
              const reliableTotalPoolTvl = poolTvl0 < poolTvl1 ? poolTvl0 * 2n : poolTvl1 * 2n;

              // Adım 3: Kullanıcının pozisyonunun nihai USD değerini bu güvenilir değere göre hesapla
              const positionValueUSD = (reliableTotalPoolTvl * bn_balance) / bn_totalSupply;

              // Adım 4: Arayüzde göstermek için, bu nihai değerden token miktarlarını türet
              const valueOfEachTokenInUSD = positionValueUSD / 2n;
              let token0DerivedAmount = 0n;
              if (token0Price > 0n) {
                token0DerivedAmount = (valueOfEachTokenInUSD * (bn_ten ** BigInt(token0Decimals))) / token0Price;
              }
              let token1DerivedAmount = 0n;
              if (token1Price > 0n) {
                token1DerivedAmount = (valueOfEachTokenInUSD * (bn_ten ** BigInt(token1Decimals))) / token1Price;
              }

              return {
                pairAddress,
                token0: { address: token0Address, symbol: token0Symbol, value: ethers.formatUnits(token0DerivedAmount, token0Decimals) },
                token1: { address: token1Address, symbol: token1Symbol, value: ethers.formatUnits(token1DerivedAmount, token1Decimals) },
                lpBalance: ethers.formatEther(balance),
                poolShare: (Number(poolShare) / 100).toFixed(4),
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
      console.error('Veri yükleme hatası:', err);

      // Hata mesajını daha anlaşılır hale getir
      let errorMessage = 'Veri alınırken bir hata oluştu.';

      if (err.code === 'NETWORK_ERROR') {
        errorMessage = 'Ağ bağlantısı hatası. Lütfen internet bağlantınızı kontrol edin.';
      } else if (err.code === 'TIMEOUT') {
        errorMessage = 'Sunucu yanıt vermedi. Lütfen daha sonra tekrar deneyin.';
      } else if (err.code === 'SERVER_ERROR') {
        errorMessage = 'Sunucu hatası. Lütfen daha sonra tekrar deneyin.';
      } else if (err.message) {
        errorMessage = `Hata: ${err.message}`;
      }

      setError(errorMessage);
      setInfoMessage('Hata oluştu.');

      // Hata durumunda önbellekteki son geçerli veriyi göster
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          setPositions(parsed.data);
          const totalValue = parsed.data.reduce((sum: number, pos: LpPosition) => sum + parseFloat(pos.totalValueUSD), 0);
          setTotalPortfolioValue(totalValue);
          setCacheTimestamp(parsed.timestamp);
        } catch (cacheErr) {
          console.error('Önbellek okuma hatası:', cacheErr);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const updateSinglePosition = useCallback(async (pairAddress: string) => {
    console.log(`Updating position for ${pairAddress}...`);
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const wallet = new ethers.Wallet(process.env.NEXT_PUBLIC_TEMP_PK!);
      const factory = new ethers.Contract(FACTORY_ADDRESS, FactoryABI.abi, provider);
      const router = new ethers.Contract(ROUTER_ADDRESS, RouterABI.abi, provider);
      const PRICE_PRECISION = 30;

      // --- Fiyatlandırma ve ondalık yardımcı fonksiyonları (fetchLpPositions'dan kopyalandı) ---
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
          return 18;
        }
      };

      const getBestAmountOut = async (tokenInAddress: string, tokenOutAddress: string, amountIn: bigint): Promise<bigint> => {
        const routes: string[][] = [
          [tokenInAddress, tokenOutAddress],
          [tokenInAddress, USDC_ADDRESS, tokenOutAddress]
        ];
        let bestAmountOut = 0n;
        for (const route of routes) {
          try {
            if (route.length === 2) {
              const pairAddr = await factory.getPair(route[0], route[1]);
              if (pairAddr === ethers.ZeroAddress) continue;
            }
            const amountsOut = await router.getAmountsOut(amountIn, route);
            const currentAmountOut = amountsOut[amountsOut.length - 1];
            if (currentAmountOut > bestAmountOut) {
              bestAmountOut = currentAmountOut;
            }
          } catch (error) { }
        }
        return bestAmountOut;
      };

      const priceCache = new Map<string, string>();
      const getTokenPriceInWSTT = async (tokenAddress: string): Promise<string> => {
        const address = tokenAddress.toLowerCase();
        if (address === WSTT_ADDRESS.toLowerCase()) return '1.0';
        if (priceCache.has(address)) return priceCache.get(address)!;
        try {
          const tokenInDecimals = await getDecimals(tokenAddress);
          const wsttDecimals = await getDecimals(WSTT_ADDRESS);
          const amountIn = ethers.parseUnits('1', tokenInDecimals);
          const bestAmountOut = await getBestAmountOut(tokenAddress, WSTT_ADDRESS, amountIn);
          if (bestAmountOut === 0n) return '0';
          const priceString = ethers.formatUnits(bestAmountOut, wsttDecimals);
          priceCache.set(address, priceString);
          return priceString;
        } catch (error) {
          return '0';
        }
      };
      // --- Yardımcı fonksiyonların sonu ---

      const pairContract = new ethers.Contract(pairAddress, PairABI.abi, provider);
      const balance = await pairContract.balanceOf(wallet.address);

      if (balance === 0n) {
        // Bakiye sıfırsa, pozisyonu listeden kaldır
        setPositions(prev => prev.filter(p => p.pairAddress.toLowerCase() !== pairAddress.toLowerCase()));
        return;
      }

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

      if (BigInt(totalSupply) === 0n) return;

      const bn_balance = BigInt(balance);
      const bn_totalSupply = BigInt(totalSupply);
      const bn_reserves0 = BigInt(reserves[0]);
      const bn_reserves1 = BigInt(reserves[1]);

      const [token0Decimals, token1Decimals] = await Promise.all([
        getDecimals(token0Address),
        getDecimals(token1Address)
      ]);
      const [price0Str, price1Str] = await Promise.all([
        getTokenPriceInWSTT(token0Address),
        getTokenPriceInWSTT(token1Address)
      ]);

      const token0Price = ethers.parseUnits(price0Str, PRICE_PRECISION);
      const token1Price = ethers.parseUnits(price1Str, PRICE_PRECISION);

      const poolShare = (bn_balance * 10000n) / bn_totalSupply;
      const bn_ten = 10n;

      const poolTvl0 = (bn_reserves0 * token0Price) / (bn_ten ** BigInt(token0Decimals));
      const poolTvl1 = (bn_reserves1 * token1Price) / (bn_ten ** BigInt(token1Decimals));
      const reliableTotalPoolTvl = poolTvl0 < poolTvl1 ? poolTvl0 * 2n : poolTvl1 * 2n;
      const positionValueUSD = (reliableTotalPoolTvl * bn_balance) / bn_totalSupply;

      const valueOfEachTokenInUSD = positionValueUSD / 2n;
      let token0DerivedAmount = 0n;
      if (token0Price > 0n) {
        token0DerivedAmount = (valueOfEachTokenInUSD * (bn_ten ** BigInt(token0Decimals))) / token0Price;
      }
      let token1DerivedAmount = 0n;
      if (token1Price > 0n) {
        token1DerivedAmount = (valueOfEachTokenInUSD * (bn_ten ** BigInt(token1Decimals))) / token1Price;
      }

      const updatedPosition: LpPosition = {
        pairAddress,
        token0: { address: token0Address, symbol: token0Symbol, value: ethers.formatUnits(token0DerivedAmount, token0Decimals) },
        token1: { address: token1Address, symbol: token1Symbol, value: ethers.formatUnits(token1DerivedAmount, token1Decimals) },
        lpBalance: ethers.formatEther(balance),
        poolShare: (Number(poolShare) / 100).toFixed(4),
        totalValueUSD: ethers.formatUnits(positionValueUSD, PRICE_PRECISION),
      };

      setPositions(prev => {
        const index = prev.findIndex(p => p.pairAddress.toLowerCase() === pairAddress.toLowerCase());
        if (index > -1) {
          const newPositions = [...prev];
          newPositions[index] = updatedPosition;
          return newPositions;
        }
        return [...prev, updatedPosition]; // Normalde bu yola girmemeli
      });

    } catch (error) {
      console.error(`Failed to update position ${pairAddress}:`, error);
      // Hata durumunda tüm listeyi yenilemeyi tetikleyebiliriz
      fetchLpPositions(true);
    }
  }, []);

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
      // Sayfa ilk yüklendiğinde filtresiz olarak tüm pozisyonları getir
      fetchLpPositions(false, null);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    // Yenileme butonu, filtreyi temizleyerek tüm pozisyonları getirir
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

    // Arama filtresi
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(pos =>
        pos.token0.symbol.toLowerCase().includes(searchLower) ||
        pos.token1.symbol.toLowerCase().includes(searchLower) ||
        pos.pairAddress.toLowerCase().includes(searchLower)
      );
    }

    // Değer aralığı filtresi
    if (minValue) {
      filtered = filtered.filter(pos => parseFloat(pos.totalValueUSD) >= parseFloat(minValue));
    }
    if (maxValue) {
      filtered = filtered.filter(pos => parseFloat(pos.totalValueUSD) <= parseFloat(maxValue));
    }

    // Sıralama
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
          totalValueUSD: parseFloat(position.totalValueUSD) // USD değerini de gönder
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'İşlem başarısız oldu.');
      }

      setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'success' }));
      // Başarılı işlem sonrası sadece bu pozisyonu güncelle
      await updateSinglePosition(position.pairAddress);

    } catch (error: any) {
      console.error("Withdraw error:", error);
      setTxError(error.message);
      setTxStatus(prev => ({ ...prev, [position.pairAddress]: 'error' }));
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
      // Token0 ve Token1 adreslerini doğrudan çiftten al
      const provider = new ethers.JsonRpcProvider(RPC_URL);
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
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'İşlem başarısız oldu.');
      }

      setDirectWithdrawStatus('success');
      // Eğer bu pozisyon zaten listede varsa, güncelle
      if (positions.some(p => p.pairAddress.toLowerCase() === directWithdrawPairAddress.toLowerCase())) {
        await updateSinglePosition(directWithdrawPairAddress);
      }

    } catch (error: any) {
      console.error("Direct withdraw error:", error);
      setDirectWithdrawError(error.message);
      setDirectWithdrawStatus('error');
    }
  }, [directWithdrawPairAddress, directWithdrawPercentage, positions, updateSinglePosition]);

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

        {/* Toplu İşlem Butonları */}
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <button
            onClick={() => {
              const allPositions = new Set(positions.map(p => p.pairAddress));
              setSelectedPositions(allPositions);
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            Tümünü Seç
          </button>
          <button
            onClick={() => setSelectedPositions(new Set())}
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
          >
            Seçimi Temizle
          </button>

          {/* Toplu Çekme Butonu ve Yüzde Seçimi */}
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                const selectedArray = Array.from(selectedPositions);
                if (selectedArray.length === 0) {
                  setTxError('Lütfen en az bir pozisyon seçin');
                  return;
                }

                for (const pairAddress of selectedArray) {
                  const position = positions.find(p => p.pairAddress === pairAddress);
                  if (position) {
                    await handleWithdraw(position, bulkWithdrawPercentage);
                  }
                }
              }}
              disabled={selectedPositions.size === 0 || isLoading}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-500 disabled:cursor-not-allowed"
            >
              Seçili Pozisyonları Çek ({selectedPositions.size})
            </button>
            <select
              value={bulkWithdrawPercentage}
              onChange={(e) => setBulkWithdrawPercentage(Number(e.target.value))}
              className="px-3 py-2 bg-gray-700 rounded text-white"
              disabled={selectedPositions.size === 0 || isLoading}
            >
              <option value="25">25%</option>
              <option value="50">50%</option>
              <option value="75">75%</option>
              <option value="100">100%</option>
            </select>
          </div>
        </div>

        {/* Arama ve Filtreleme Arayüzü */}
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

          {/* Alt Satır: Doğrudan Çekim */}
          <div className="border-t border-gray-700 pt-4">
            <label className="block text-lg font-medium mb-2">Doğrudan Çift Adresinden Çekim</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Çift Adresi (Pair Address)</label>
                <input
                  type="text"
                  value={directWithdrawPairAddress}
                  onChange={(e) => setDirectWithdrawPairAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 bg-gray-700 rounded text-white placeholder-gray-400 font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Çekim Oranı (%)</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={directWithdrawPercentage}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    setDirectWithdrawPercentage(isNaN(value) ? 0 : value);
                  }}
                  className="w-full px-3 py-2 bg-gray-700 rounded text-white"
                />
              </div>
              <div className="md:col-span-3">
                <button
                  onClick={handleDirectWithdraw}
                  disabled={directWithdrawStatus === 'pending' || !directWithdrawPairAddress}
                  className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-bold py-3 px-4 rounded-lg disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed transition-all duration-300 shadow-lg"
                >
                  {directWithdrawStatus === 'pending' ? 'İşlem Gönderiliyor...' : 'Çekim Yap'}
                </button>
              </div>
            </div>
            {directWithdrawStatus === 'error' && directWithdrawError && (
              <p className="text-red-400 mt-2 text-sm">{directWithdrawError}</p>
            )}
            {directWithdrawStatus === 'success' && (
              <p className="text-green-400 mt-2 text-sm">İşlem başarıyla gönderildi!</p>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredAndSortedPositions.map((pos) => (
            <div key={pos.pairAddress} className="bg-gray-800 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 animate-fade-in relative border border-gray-700">
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

              {/* Başlık ve Değer */}
              <div className="flex justify-between items-start mt-2 mb-4">
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-white mb-1">{pos.token0.symbol}/{pos.token1.symbol}</h3>
                  <p className="text-xs text-gray-400 font-mono break-all">{pos.pairAddress}</p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-bold text-green-400">${formatToDecimals(Number(pos.totalValueUSD))}</span>
                </div>
              </div>

              {/* LP ve Havuz Bilgileri */}
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

              {/* Token Değerleri */}
              <div className="bg-gray-700/30 p-4 rounded-lg mb-4">
                <p className="text-sm text-gray-400 mb-2">Token Değerleri</p>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{pos.token0.symbol}</span>
                    <span>{formatToDecimals(parseFloat(pos.token0.value))}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{pos.token1.symbol}</span>
                    <span>{formatToDecimals(parseFloat(pos.token1.value))}</span>
                  </div>
                </div>
              </div>

              {/* Yüzde Seçim Alanı */}
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
                    className="w-full px-3 py-2 bg-gray-700 rounded text-white placeholder-gray-400"
                  />
                  <div className="flex gap-1">
                    {[25, 50, 75, 100].map((p) => (
                      <button
                        key={p}
                        onClick={() => setWithdrawPercentages(prev => ({ ...prev, [pos.pairAddress]: p }))}
                        className={`px-3 py-2 rounded-lg text-xs font-bold transition-colors ${withdrawPercentages[pos.pairAddress] === p
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-600 hover:bg-gray-500 text-gray-300'
                          }`}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* İşlem Butonu */}
              <div>
                <button
                  onClick={() => handleWithdraw(pos, withdrawPercentages[pos.pairAddress] || 100)}
                  disabled={txStatus[pos.pairAddress] === 'pending' || isLoading || !withdrawPercentages[pos.pairAddress]}
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
          ))}
        </div>

        {!isLoading && positions.length === 0 && !error && (
          <p className="mt-4">Bu cüzdana ait LP pozisyonu bulunamadı.</p>
        )}
      </div>
    </main>
  );
}