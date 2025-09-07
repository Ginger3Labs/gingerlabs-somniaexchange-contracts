export interface FactoryIndexer {
    _id: string;
    transactionHash: string;
    blockHash: string;
    blockNumber: number;
    contractAddress: string;
    createdAt: Date;
    eventName: string;
    parameters: {
        token0: string;
        token1: string;
        pair: string;
    };
    processed: boolean;
    processedAt: Date;
    retryCount: number;
    source: string;
    timestamp: Date;
    updatedAt: Date;
    chain_id: number;
    lastScannedBlock: number;
    nextScanAvailableAt: Date;
}

export interface PairInfo {
    address: string;
    token0: string;
    token1: string;
    reserves?: {
        reserve0: string;
        reserve1: string;
        blockTimestampLast: number;
    };
    tvl?: number;
    price0?: string;
    price1?: string;
    lastUpdatedAt?: Date;
}

