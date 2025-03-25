import { createPublicClient, createWalletClient, http, type Address, parseEther, parseUnits, formatUnits } from 'viem';
import {anvil, arbitrum, mainnet} from 'viem/chains';
import config, {gtxRouterAbi, poolManagerAbi} from '../config/config';
import { Side, PoolKey, PriceVolumeResponse, PoolResponse, OrderResponse } from '../types';
import axios from 'axios';

const chain = anvil;

const publicClient = createPublicClient({
    chain: chain,
    transport: http(config.rpcUrl),
});

const ethClient = createPublicClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
});

const walletClient = createWalletClient({
    chain: chain,
    transport: http(config.rpcUrl),
    account: config.account,
});

export class MarketMaker {
    private priceRefreshInterval: NodeJS.Timeout | null = null;
    private activeOrderIds: { [side: number]: string[] } = { [Side.BUY]: [], [Side.SELL]: [] };
    private lastMidPrice: bigint = 0n;
    private poolKey: PoolKey;
    private config;

    constructor() {
        this.config = config;

        if (!config.baseToken || !config.quoteToken) {
            throw new Error("Base token or quote token not defined in config");
        }

        this.poolKey = {
            baseCurrency: config.baseToken as Address,
            quoteCurrency: config.quoteToken as Address,
        };
    }

    async initialize() {
        console.log('Initializing market maker bot...');
        console.log(`Using network with chainId: ${config.chainId}`);

        try {
            await this.verifyPool();
            await this.checkAndApproveTokens();
            console.log('Market maker initialized successfully');
            return true;
        } catch (error) {
            console.error('Failed to initialize market maker:', error);
            return false;
        }
    }

    private async verifyPool() {
        try {
            const pool = await publicClient.readContract({
                address: config.poolManagerAddress,
                abi: poolManagerAbi,
                functionName: 'getPool',
                args: [this.poolKey],
            });

            return pool;
        } catch (error) {
            console.error('Error verifying pool:', error);
            throw new Error('Pool does not exist');
        }
    }

    private async checkAndApproveTokens() {
        //NOTE: Call setup.ts
        console.log('Token allowances verified');
    }

    async start() {
        console.log('Starting market maker bot...');

        await this.cancelAllOrders();
        await this.updateMarketData();

        this.priceRefreshInterval = setInterval(async () => {
            try {
                await this.performMarketMakingCycle();
            } catch (error) {
                console.error('Error in market making cycle:', error);
            }
        }, config.refreshInterval);

        await this.performMarketMakingCycle();

        console.log('Market maker bot running...');
    }

    async stop() {
        console.log('Stopping market maker bot...');

        if (this.priceRefreshInterval) {
            clearInterval(this.priceRefreshInterval);
            this.priceRefreshInterval = null;
        }

        await this.cancelAllOrders();

        console.log('Market maker bot stopped');
    }

    private async performMarketMakingCycle() {
        console.log('Performing market making cycle...');

        await this.updateMarketData();

        if (this.shouldReplaceOrders()) {
            await this.cancelAllOrders();
        }

        await this.placeMakerOrders();

        console.log('Market making cycle completed');
    }

    private async updateMarketData() {
        try {
            const chainlinkPrice = await this.fetchChainlinkPrice();

            if (chainlinkPrice > 0n) {
                this.lastMidPrice = chainlinkPrice;
                console.log(`Using Chainlink price: ${formatUnits(chainlinkPrice, 8)} USD`);
            }

            await this.updateActiveOrders();

        } catch (error) {
            console.error('Error updating market data:', error);
        }
    }

    private async fetchChainlinkPrice(): Promise<bigint> {
        try {
            const chainlinkFeed = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
            const response = await ethClient.readContract({
                address: chainlinkFeed as Address,
                abi: [
                    {
                        inputs: [],
                        name: 'latestRoundData',
                        outputs: [
                            { name: 'roundId', type: 'uint80' },
                            { name: 'answer', type: 'int256' },
                            { name: 'startedAt', type: 'uint256' },
                            { name: 'updatedAt', type: 'uint256' },
                            { name: 'answeredInRound', type: 'uint80' }
                        ],
                        stateMutability: 'view',
                        type: 'function'
                    }
                ],
                functionName: 'latestRoundData'
            });

            const [, price, , updatedAt] = response;
            const stalePriceThreshold = 3600; // 1 hour
            const timestamp = Math.floor(Date.now() / 1000);

            if (timestamp - Number(updatedAt) > stalePriceThreshold) {
                throw new Error('Chainlink price is stale');
            }

            return BigInt(price);
        } catch (error) {
            console.error('Error fetching price from Chainlink:', error);
            return 0n;
        }
    }

    private async getBestPrice(side: Side): Promise<PriceVolumeResponse> {
        try {
            const result = await publicClient.readContract({
                address: config.routerAddress,
                abi: gtxRouterAbi,
                functionName: 'getBestPrice',
                args: [this.poolKey, side],
            });

            const typedResult = result as unknown as { price: bigint; volume: bigint };
            return {
                price: typedResult.price,
                volume: typedResult.volume
            };
        } catch (error) {
            console.error(`Error getting best ${side === Side.BUY ? 'bid' : 'ask'} price:`, error);
            return { price: 0n, volume: 0n };
        }
    }

    private async updateActiveOrders() {
        try {
            const userActiveOrders = await publicClient.readContract({
                address: config.routerAddress,
                abi: gtxRouterAbi,
                functionName: 'getUserActiveOrders',
                args: [this.poolKey, config.account.address],
            }) as OrderResponse[];

            this.activeOrderIds = { [Side.BUY]: [], [Side.SELL]: [] };

            for (const order of userActiveOrders) {
                const side = order.price > this.lastMidPrice ? Side.SELL : Side.BUY;
                this.activeOrderIds[side].push(order.id);
            }

            console.log(`Active orders - Buy: ${this.activeOrderIds[Side.BUY].length}, Sell: ${this.activeOrderIds[Side.SELL].length}`);
        } catch (error) {
            console.error('Error updating active orders:', error);
        }
    }

    private shouldReplaceOrders(): boolean {
        return true;
    }

    private async cancelAllOrders() {
        console.log('Cancelling all active orders...');

        try {
            const userActiveOrders = await publicClient.readContract({
                address: this.config.routerAddress,
                abi: gtxRouterAbi,
                functionName: 'getUserActiveOrders',
                args: [this.poolKey, this.config.account.address],
            }) as OrderResponse[];

            for (const order of userActiveOrders) {
                const side = order.price > this.lastMidPrice ? Side.SELL : Side.BUY;

                console.log(`Cancelling ${side === Side.BUY ? 'buy' : 'sell'} order ${order.id} at price ${formatUnits(order.price, 8)}`);

                await walletClient.writeContract({
                    address: this.config.routerAddress,
                    abi: gtxRouterAbi,
                    functionName: 'cancelOrder',
                    args: [this.poolKey, side, order.price, order.id],
                });
            }

            this.activeOrderIds = { [Side.BUY]: [], [Side.SELL]: [] };
            console.log('All orders cancelled');
        } catch (error) {
            console.error('Error cancelling orders:', error);
        }
    }

    private async placeMakerOrders() {
        if (this.lastMidPrice === 0n) {
            console.error('Cannot place orders: No mid price available');
            return;
        }

        console.log('Placing maker orders...');

        const spreadBasisPoints = BigInt(Math.round(this.config.spreadPercentage * 100));
        const priceStepBasisPoints = BigInt(Math.round(this.config.priceStepPercentage * 100));

        for (let i = 0; i < this.config.maxOrdersPerSide; i++) {
            const totalBasisPoints = spreadBasisPoints + (priceStepBasisPoints * BigInt(i));
            const buyPrice = this.lastMidPrice - (this.lastMidPrice * totalBasisPoints / 10000n);

            await this.placeOrder(Side.BUY, buyPrice, config.orderSize);
        }

        for (let i = 0; i < this.config.maxOrdersPerSide; i++) {
            const totalBasisPoints = spreadBasisPoints + (priceStepBasisPoints * BigInt(i));
            const sellPrice = this.lastMidPrice + (this.lastMidPrice * totalBasisPoints / 10000n);

            await this.placeOrder(Side.SELL, sellPrice, this.config.orderSize);
        }

        console.log('Maker orders placed');
    }

    private async placeOrder(side: Side, price: bigint, quantity: bigint) {
        try {
            console.log(`Placing ${side === Side.BUY ? 'buy' : 'sell'} order at price ${formatUnits(price, 8)} USD with quantity ${formatUnits(quantity, 18)} ETH`);

            const tx = await walletClient.writeContract({
                address: this.config.routerAddress,
                abi: gtxRouterAbi,
                functionName: 'placeOrderWithDeposit',
                args: [this.poolKey, price, quantity, side],
            });

            console.log(`Order placed, transaction: ${tx}`);
        } catch (error) {
            console.error(`Error placing ${side === Side.BUY ? 'buy' : 'sell'} order:`, error);
        }
    }
}
