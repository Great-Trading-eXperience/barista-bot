import { parseUnits, type Address, Chain } from 'viem';
import * as dotenv from 'dotenv';
import { deployedContracts } from '../abis/deployedContracts';
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from 'viem/chains';
import { rise, espresso, anvilDev } from './chain';

dotenv.config();

const chainId = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : 31337;
const poolManagerAddress = process.env.POOLMANAGER_CONTRACT_ADDRESS;
const gtxRouterAddress = process.env.GTXROUTER_CONTRACT_ADDRESS;
const balanceManagerAddress = process.env.BALANCEMANAGER_CONTRACT_ADDRESS;
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

export const gtxRouterAbi = deployedContracts[chainId]?.GTXRouter?.abi;
export const poolManagerAbi = deployedContracts[chainId]?.PoolManager?.abi;
export const balanaceManagerAbi = deployedContracts[chainId]?.BalanceManager?.abi;

export function getChainConfig(): Chain {
    switch (chainId) {
        case 11155931:
            return rise;
        case 1020201:
            return espresso;
        case 313371:
            return anvilDev;
        case 31337:
        default:
            return anvil;
    }
}

const config = {
    poolManagerAddress: poolManagerAddress as Address,
    routerAddress: gtxRouterAddress as Address,
    balanceManagerAddress: balanceManagerAddress as Address,

    baseToken: process.env.BASE_TOKEN_ADDRESS as Address,
    quoteToken: process.env.QUOTE_TOKEN_ADDRESS as Address,

    spreadPercentage: Number(process.env.SPREAD_PERCENTAGE || 0.2), // Default 0.2%
    orderSize: parseUnits(process.env.ORDER_SIZE || '0.1', 18), // Default 0.1 base token
    maxOrdersPerSide: Number(process.env.MAX_ORDERS_PER_SIDE || 5),
    priceStepPercentage: Number(process.env.PRICE_STEP_PERCENTAGE || 0.1), // Default 0.1%
    refreshInterval: Number(process.env.REFRESH_INTERVAL || 60000), // Default 1 minute
    priceDeviationThresholdBps: Number(process.env.PRICE_DEVIATION_THRESHOLD_BPS || 500), // Default 5%
    useBinancePrice: process.env.USE_BINANCE_PRICE === 'true',

    privateKey: process.env.PRIVATE_KEY as string,
    account: account,

    rpcUrl: process.env.RPC_URL as string,
    chainId: chainId,

    mainnetRpcUrl: process.env.MAINNET_RPC_URL

};

export default config;
