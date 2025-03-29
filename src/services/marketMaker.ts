import { createPublicClient, createWalletClient, http, type Address, parseEther, parseUnits, formatUnits, Chain, EIP1193RequestFn, TransportConfig} from 'viem';
import {mainnet} from 'viem/chains';
import config, {gtxRouterAbi, poolManagerAbi, getChainConfig} from '../config/config';
import {Side, PoolKey, PriceVolumeResponse, PoolResponse, OrderResponse} from '../types';
import {setup} from "../scripts/setup";

const chain = getChainConfig();

const publicClient = createPublicClient({
    chain: chain,
    transport: http(chain.rpcUrls.default.http.toString())
});

const ethClient = createPublicClient({
    chain: mainnet,
    transport: http(config.mainnetRpcUrl),
});

const walletClient = createWalletClient({
    chain: chain,
    transport: http(chain.rpcUrls.default.http.toString()),
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
        try {
            console.log('Checking token balances and approvals...');

            const setupResult = await setup();

            if (!setupResult) {
                throw new Error('Failed to set up token balances and approvals');
            }

            console.log('Token balances and allowances verified');
            return true;
        } catch (error) {
            console.error('Error checking and approving tokens:', error);
            throw error;
        }
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

        // Store previous mid price for comparison
        const previousMidPrice = this.lastMidPrice;

        // Update market data including the latest price
        await this.updateMarketData();

        // If no previous price (first run) or price deviation exceeds threshold, replace orders
        if (previousMidPrice === 0n || this.isPriceDeviationSignificant(previousMidPrice, this.lastMidPrice)) {
            console.log('Price deviation exceeds threshold, replacing orders');
            await this.cancelAndReplaceOrders();
        } else {
            // Only place new orders where needed
            await this.fillMissingOrders();
        }

        console.log('Market making cycle completed');
    }

    private async updateMarketData() {
        try {
            let price = 0n;

            if (this.config.useBinancePrice) {
                price = await this.fetchBinancePrice();
                if (price > 0n) {
                    console.log(`Using Binance price: ${formatUnits(price, 8)} USD`);
                }
            }

            // If Binance price failed or is not enabled, try Chainlink as fallback
            if (price === 0n) {
                price = await this.fetchChainlinkPrice();
                if (price > 0n) {
                    console.log(`Using Chainlink price: ${formatUnits(price, 8)} USD`);
                }
            }

            if (price > 0n) {
                this.lastMidPrice = price;
            }

            await this.updateActiveOrders();
        } catch (error) {
            console.error('Error updating market data:', error);
        }
    }

    private async fetchBinancePrice(): Promise<bigint> {
        try {
            // Using public Binance API endpoint for ETH/USDC price
            const response = await fetch('https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDC');

            if (!response.ok) {
                throw new Error(`Binance API error: ${response.status}`);
            }

            const data = await response.json();
            if (!data || !data.price) {
                throw new Error('Invalid response from Binance API');
            }

            // Convert price to bigint with 8 decimal places (same as Chainlink format)
            const price = parseFloat(data.price);
            return BigInt(Math.round(price * 100000000));
        } catch (error) {
            console.error('Error fetching price from Binance:', error);
            return 0n;
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


    private isPriceDeviationSignificant(oldPrice: bigint, newPrice: bigint): boolean {
        if (oldPrice === 0n || newPrice === 0n) return true;

        // Calculate the absolute percentage difference
        const priceDifference = oldPrice > newPrice
            ? oldPrice - newPrice
            : newPrice - oldPrice;

        const deviationBps = (priceDifference * 10000n) / oldPrice;
        const thresholdBps = BigInt(this.config.priceDeviationThresholdBps);

        console.log(`Price deviation: ${Number(deviationBps)/100}% (threshold: ${Number(thresholdBps)/100}%)`);

        return deviationBps > thresholdBps;
    }

    private async cancelAndReplaceOrders() {
        await this.cancelAllOrders();
        await this.placeMakerOrders();
    }

    private async fillMissingOrders() {
        try {
            // Retrieve current active orders
            const userActiveOrders = await publicClient.readContract({
                address: config.routerAddress,
                abi: gtxRouterAbi,
                functionName: 'getUserActiveOrders',
                args: [this.poolKey, config.account.address],
            }) as OrderResponse[];

            // Count orders by side
            const buyOrders = userActiveOrders.filter(order => order.price < this.lastMidPrice);
            const sellOrders = userActiveOrders.filter(order => order.price > this.lastMidPrice);

            console.log(`Current orders - Buy: ${buyOrders.length}, Sell: ${sellOrders.length}`);

            // Calculate how many orders to add on each side
            const buyOrdersToAdd = Math.max(0, this.config.maxOrdersPerSide - buyOrders.length);
            const sellOrdersToAdd = Math.max(0, this.config.maxOrdersPerSide - sellOrders.length);

            if (buyOrdersToAdd > 0 || sellOrdersToAdd > 0) {
                console.log(`Adding missing orders - Buy: ${buyOrdersToAdd}, Sell: ${sellOrdersToAdd}`);

                const spreadBasisPoints = BigInt(Math.round(this.config.spreadPercentage * 100));
                const priceStepBasisPoints = BigInt(Math.round(this.config.priceStepPercentage * 100));

                // Add missing buy orders
                for (let i = 0; i < buyOrdersToAdd; i++) {
                    // Calculate position for new order
                    const position = this.config.maxOrdersPerSide - buyOrdersToAdd + i;
                    const totalBasisPoints = spreadBasisPoints + (priceStepBasisPoints * BigInt(position));
                    const buyPrice = this.lastMidPrice - (this.lastMidPrice * totalBasisPoints / 10000n);

                    await this.placeOrder(Side.BUY, buyPrice, config.orderSize);
                }

                // Add missing sell orders
                for (let i = 0; i < sellOrdersToAdd; i++) {
                    // Calculate position for new order
                    const position = this.config.maxOrdersPerSide - sellOrdersToAdd + i;
                    const totalBasisPoints = spreadBasisPoints + (priceStepBasisPoints * BigInt(position));
                    const sellPrice = this.lastMidPrice + (this.lastMidPrice * totalBasisPoints / 10000n);

                    await this.placeOrder(Side.SELL, sellPrice, this.config.orderSize);
                }
            } else {
                console.log('No new orders needed - order book already balanced');
            }
        } catch (error) {
            console.error('Error filling missing orders:', error);
        }
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
