import { parseUnits, type Address, Chain, getAddress } from 'viem';
import * as dotenv from 'dotenv';
import { deployedContracts } from '../abis/deployedContracts';
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from 'viem/chains';
import { rise, espresso, anvilDev } from './chain';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import logger from '../utils/logger';

dotenv.config();

const argv = yargs(hideBin(process.argv))
    .option('chain-id', {
        type: 'number',
        description: 'Blockchain network ID to use'
    })
    .parseSync();

const chainId = argv['chain-id'] ||
    (process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : 31337);

logger.info(`Using chain ID: ${chainId}`);

// Token configuration by chain ID
const chainTokenConfig: Record<number, { baseToken: Address, quoteToken: Address }> = {
    // Rise Network
    11155931: {
        baseToken: (process.env.RISE_BASE_TOKEN_ADDRESS || process.env.BASE_TOKEN_ADDRESS) as Address,
        quoteToken: (process.env.RISE_QUOTE_TOKEN_ADDRESS || process.env.QUOTE_TOKEN_ADDRESS) as Address,
    },
    // Espresso Network
    1020201: {
        baseToken: (process.env.ESPRESSO_BASE_TOKEN_ADDRESS || process.env.BASE_TOKEN_ADDRESS) as Address,
        quoteToken: (process.env.ESPRESSO_QUOTE_TOKEN_ADDRESS || process.env.QUOTE_TOKEN_ADDRESS) as Address,
    },
    // Anvil Dev
    31338: {
        baseToken: (process.env.ANVIL_DEV_BASE_TOKEN_ADDRESS || process.env.BASE_TOKEN_ADDRESS) as Address,
        quoteToken: (process.env.ANVIL_DEV_QUOTE_TOKEN_ADDRESS || process.env.QUOTE_TOKEN_ADDRESS) as Address,
    },
    // Anvil (default)
    31337: {
        baseToken: (process.env.ANVIL_BASE_TOKEN_ADDRESS || process.env.BASE_TOKEN_ADDRESS) as Address,
        quoteToken: (process.env.ANVIL_QUOTE_TOKEN_ADDRESS || process.env.QUOTE_TOKEN_ADDRESS) as Address,
    }
};

const poolManagerAddress = getAddress(deployedContracts[chainId]?.PoolManager?.address);
const gtxRouterAddress = getAddress(deployedContracts[chainId]?.GTXRouter?.address);
const balanceManagerAddress = getAddress(deployedContracts[chainId]?.BalanceManager?.address);
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

export const gtxRouterAbi = deployedContracts[chainId]?.GTXRouter?.abi;
export const poolManagerAbi = deployedContracts[chainId]?.PoolManager?.abi;
export const balanaceManagerAbi = deployedContracts[chainId]?.BalanceManager?.abi;

export function getChainConfig(): Chain {
    logger.info(`Using chain configuration for chain ID: ${chainId}`);
    switch (chainId) {
        case 11155931:
            return rise;
        case 1020201:
            return espresso;
        case 31338:
            return anvilDev;
        case 31337:
        default:
            return anvil;
    }
}

const currentChainTokens = chainTokenConfig[chainId] || {
    baseToken: process.env.BASE_TOKEN_ADDRESS as Address,
    quoteToken: process.env.QUOTE_TOKEN_ADDRESS as Address,
};

const config = {
    poolManagerAddress: poolManagerAddress as Address,
    routerAddress: gtxRouterAddress as Address,
    balanceManagerAddress: balanceManagerAddress as Address,

    baseToken: currentChainTokens.baseToken,
    quoteToken: currentChainTokens.quoteToken,

    spreadPercentage: Number(process.env.SPREAD_PERCENTAGE ?? 0.2), // Default 0.2%
    orderSize: parseUnits(process.env.ORDER_SIZE ?? '0.1', 18), // Default 0.1 base token
    maxOrdersPerSide: Number(process.env.MAX_ORDERS_PER_SIDE ?? 5),
    priceStepPercentage: Number(process.env.PRICE_STEP_PERCENTAGE ?? 0.1), // Default 0.1%
    refreshInterval: Number(process.env.REFRESH_INTERVAL ?? 60000), // Default 1 minute
    priceDeviationThresholdBps: Number(process.env.PRICE_DEVIATION_THRESHOLD_BPS ?? 500), // Default 5%
    useBinancePrice: process.env.USE_BINANCE_PRICE === 'true',

    privateKey: process.env.PRIVATE_KEY as string,
    account: account,

    rpcUrl: process.env.RPC_URL as string,
    chainId: chainId,

    mainnetRpcUrl: process.env.MAINNET_RPC_URL
};

export default config;