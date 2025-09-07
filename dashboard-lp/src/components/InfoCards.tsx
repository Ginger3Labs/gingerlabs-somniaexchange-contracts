import { formatToDecimals } from '../../format';
import { FactoryInfo } from '@/types/lp';

interface InfoCardsProps {
    signerAddress: string;
    totalPortfolioValue: number;
    targetTokenSymbol: string;
    cacheTimestamp: number | null;
    factoryInfo: FactoryInfo;
    factoryAddress: string;
    routerAddress: string;
}

export function InfoCards({
    signerAddress,
    totalPortfolioValue,
    targetTokenSymbol,
    cacheTimestamp,
    factoryInfo,
    factoryAddress,
    routerAddress
}: InfoCardsProps) {
    return (
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
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
                    <div className="bg-gray-800/50 p-3 rounded-lg">
                        <span className="block text-gray-400 mb-1">Wrapped Token (WSTT)</span>
                        <span className="font-mono text-white/90 break-all">{factoryInfo.wrappedTokenAddress}</span>
                    </div>
                    <div className="bg-gray-800/50 p-3 rounded-lg md:col-span-1 lg:col-span-1">
                        <span className="block text-gray-400 mb-1">Factory Kontratı</span>
                        <span className="font-mono text-white/90 break-all">{factoryAddress}</span>
                    </div>
                    <div className="bg-gray-800/50 p-3 rounded-lg md:col-span-1 lg:col-span-1">
                        <span className="block text-gray-400 mb-1">Router Kontratı</span>
                        <span className="font-mono text-white/90 break-all">{routerAddress}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

