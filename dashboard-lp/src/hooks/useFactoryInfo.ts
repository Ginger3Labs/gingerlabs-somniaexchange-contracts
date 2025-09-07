import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import FactoryABI from '@/abis/SomniaExchangeFactory.json';
import RouterABI from '@/abis/SomniaExchangeRouter.json';
import { FactoryInfo } from '@/types/lp';
import { DEFAULT_FACTORY_INFO, NULL_ADDRESS } from '@/constants/lp';

export function useFactoryInfo(
    provider: ethers.Provider,
    factoryAddress: string,
    routerAddress: string
) {
    const [factoryInfo, setFactoryInfo] = useState<FactoryInfo>(DEFAULT_FACTORY_INFO);

    const fetchFactoryInfo = useCallback(async () => {
        if (!factoryAddress || !routerAddress || !provider) return;

        try {
            const factoryContract = new ethers.Contract(factoryAddress, FactoryABI.abi, provider);
            const routerContract = new ethers.Contract(routerAddress, RouterABI.abi, provider);

            const [feeTo, feeToSetter, allPairsLength, wrappedTokenAddress] = await Promise.all([
                factoryContract.feeTo(),
                factoryContract.feeToSetter(),
                factoryContract.allPairsLength(),
                routerContract.WETH()
            ]);

            setFactoryInfo({
                feeTo,
                feeToSetter,
                protocolFeeStatus: feeTo === NULL_ADDRESS ? 'Kapalı' : 'Açık',
                totalPairs: Number(allPairsLength),
                wrappedTokenAddress
            });
        } catch (error) {
            console.error("Fabrika bilgileri alınamadı:", error);
            setFactoryInfo({
                feeTo: 'Hata',
                feeToSetter: 'Hata',
                protocolFeeStatus: 'Kapalı',
                totalPairs: 0,
                wrappedTokenAddress: 'Hata'
            });
        }
    }, [provider, factoryAddress, routerAddress]);

    return { factoryInfo, fetchFactoryInfo };
}

