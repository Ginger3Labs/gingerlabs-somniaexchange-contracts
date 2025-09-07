export interface LpPosition {
    pairAddress: string;
    token0: {
        address: string;
        symbol: string;
        route: string[];
    };
    token1: {
        address: string;
        symbol: string;
        route: string[];
    };
    lpBalance: string;
    poolShare: string;
    totalValueUSD: string;
    // Pre-calculated values for 100% withdrawal
    estimatedWithdraw: {
        token0Amount: string; // e.g., "150.25"
        token1Amount: string; // e.g., "0.89"
        token0ValueInTarget: string; // e.g., "120.50" (value in TARGET_TOKEN)
        token1ValueInTarget: string; // e.g., "118.90" (value in TARGET_TOKEN)
        totalValueInTarget: string;  // e.g., "239.40"
    };
}

export interface TrackedTokenBalance {
    address: string;
    symbol: string;
    balance: string;
}

export interface CacheData {
    timestamp: number;
    data: LpPosition[];
    lastScannedIndex: number;
    totalPairCount: number;
}

export interface FactoryInfo {
    feeTo: string;
    feeToSetter: string;
    protocolFeeStatus: 'Açık' | 'Kapalı' | 'Yükleniyor...';
    totalPairs: number;
    wrappedTokenAddress: string;
}

export interface EstimatedTokenValues {
    token0: string;
    token1: string;
    total: string;
}

