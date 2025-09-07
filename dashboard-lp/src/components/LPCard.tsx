import { useState } from 'react';
import { formatToDecimals } from '../../format';
import { LpPosition } from '@/types/lp';
import { formatUnits } from 'ethers';

interface LPCardProps {
    position: LpPosition;
    targetTokenSymbol: string;
    onWithdraw: (position: LpPosition, percentage: number) => void;
    isWithdrawing: boolean;
}

export function LPCard({
    position,
    targetTokenSymbol,
    onWithdraw,
    isWithdrawing,
}: LPCardProps) {
    const [withdrawPercentage, setWithdrawPercentage] = useState(100);

    const renderRoute = (route: string[] | undefined) => {
        if (!route || route.length < 2) return null;
        // This is a simplified version. A real app might use a global symbol cache.
        const symbols = route.map(address => {
            if (address.toLowerCase() === position.token0.address.toLowerCase()) return position.token0.symbol;
            if (address.toLowerCase() === position.token1.address.toLowerCase()) return position.token1.symbol;
            if (address.toLowerCase() === process.env.NEXT_PUBLIC_TARGET_TOKEN_ADDRESS?.toLowerCase()) return targetTokenSymbol;
            return address.slice(0, 6);
        });
        return symbols.join(' → ');
    };
    return (
        <div className="bg-gray-800/80 backdrop-blur-sm p-6 rounded-2xl shadow-xl border border-gray-700/50 flex flex-col group hover:border-blue-500/30 transition-all duration-300">
            <div className="flex-grow space-y-2">
                {/* Header */}
                <div className="space-y-3">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 text-transparent bg-clip-text max-w-2xs truncate">
                                {position.token0.symbol}/{position.token1.symbol}
                            </h3>
                            <p className="text-xs text-gray-400 font-mono mt-1">
                                {`${position.pairAddress.slice(0, 6)}...${position.pairAddress.slice(-4)}`}
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-2">
                                <span className="block text-2xl font-bold text-green-400">
                                    {formatToDecimals(Number(position.totalValueUSD))}
                                </span>
                                <span className="text-sm text-green-500">{targetTokenSymbol}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Token Details */}
                <div className="space-y-4 mt-4">
                    <p className="text-xs text-center text-gray-500">
                        LP Balance: {parseFloat(formatUnits(position.lpBalance, 18)).toFixed(6)}
                    </p>
                    {/* Token 0 */}
                    <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-gray-300 font-medium">{position.token0.symbol}</span>
                            <span className="font-mono text-white">{formatToDecimals(Number(position.estimatedWithdraw.token0Amount))}</span>
                        </div>
                        {renderRoute(position.token0.route) && (
                            <div className="text-xs text-gray-500 bg-gray-800/50 px-3 py-1.5 rounded-lg">
                                {renderRoute(position.token0.route)}
                            </div>
                        )}
                    </div>

                    {/* Token 1 */}
                    <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-gray-300 font-medium">{position.token1.symbol}</span>
                            <span className="font-mono text-white">{formatToDecimals(Number(position.estimatedWithdraw.token1Amount))}</span>
                        </div>
                        {renderRoute(position.token1.route) && (
                            <div className="text-xs text-gray-500 bg-gray-800/50 px-3 py-1.5 rounded-lg">
                                {renderRoute(position.token1.route)}
                            </div>
                        )}
                    </div>
                </div>

                {/* Pool Stats */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30">
                        <span className="block text-sm text-gray-400 mb-1">LP Bakiyesi</span>
                        <span className="font-mono text-white">{formatToDecimals(Number(position.lpBalance))}</span>
                    </div>
                    <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30">
                        <span className="block text-sm text-gray-400 mb-1">Havuz Payı</span>
                        <span className="font-mono text-white">{Number(position.poolShare).toFixed(2)}%</span>
                    </div>
                </div>

                {/* Estimated Returns */}
                {position.estimatedWithdraw && (
                    <div className="bg-blue-900/20 rounded-xl p-4 border border-blue-500/20">
                        <div className="space-y-2">
                            <p className="text-blue-400 font-medium">Tahmini Getiri (%{withdrawPercentage})</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-gray-900/30 rounded-lg p-2">
                                    <span className="block text-xs text-gray-400">{position.token0.symbol}</span>
                                    <span className="text-sm font-mono text-white">
                                        {formatToDecimals(parseFloat(position.estimatedWithdraw.token0ValueInTarget) * (withdrawPercentage / 100))} {targetTokenSymbol}
                                    </span>
                                </div>
                                <div className="bg-gray-900/30 rounded-lg p-2">
                                    <span className="block text-xs text-gray-400">{position.token1.symbol}</span>
                                    <span className="text-sm font-mono text-white">
                                        {formatToDecimals(parseFloat(position.estimatedWithdraw.token1ValueInTarget) * (withdrawPercentage / 100))} {targetTokenSymbol}
                                    </span>
                                </div>
                            </div>
                            <div className="bg-blue-500/10 rounded-lg p-2 mt-2">
                                <span className="block text-xs text-blue-400">Toplam</span>
                                <span className="text-sm font-mono text-blue-300">
                                    ≈ {formatToDecimals(parseFloat(position.estimatedWithdraw.totalValueInTarget) * (withdrawPercentage / 100))} {targetTokenSymbol}
                                </span>
                            </div>
                        </div>
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
                        value={withdrawPercentage}
                        onChange={(e) => setWithdrawPercentage(parseInt(e.target.value, 10) || 0)}
                        className="flex-1 px-4 py-3 bg-gray-900/50 rounded-xl border border-gray-700/30 focus:border-blue-500/50 focus:outline-none transition-colors"
                        placeholder="Yüzde girin..."
                    />
                    <button
                        onClick={() => onWithdraw(position, withdrawPercentage)}
                        disabled={isWithdrawing}
                        className="flex-1 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-medium py-3 px-6 rounded-xl disabled:from-gray-600 disabled:to-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg"
                    >
                        {isWithdrawing ? (
                            <div className="flex items-center justify-center gap-2">
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                <span>Çekiliyor...</span>
                            </div>
                        ) : (
                            `Çek (%${withdrawPercentage})`
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

