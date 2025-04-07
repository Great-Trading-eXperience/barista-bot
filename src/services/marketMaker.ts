import { formatUnits } from 'viem';
import config from '../config/config';
import { Side } from '../types';
import { setup } from "../scripts/setup";
import { ContractService } from './contractService';

export class MarketMaker {
    private priceRefreshInterval: NodeJS.Timeout | null = null;
    private activeOrderIds: { [side: number]: string[] } = { [Side.BUY]: [], [Side.SELL]: [] };
    private lastMidPrice: bigint = 0n;
    private contractService: ContractService;
    private config;

    constructor() {
        this.config = config;
        this.contractService = new ContractService();
    }

    // Add this helper method after the constructor
    private roundToNearestPriceIncrement(price: bigint): bigint {
        // Convert to base units (6 decimals for USDC)
        const minPriceIncrement = 10000n; // 0.01 USDC in 6 decimal format
        return (price / minPriceIncrement) * minPriceIncrement;
    }

    async initialize() {
        console.log('Initializing market maker bot...');
        console.log(`Using network with chainId: ${config.chainId}`);

        try {
            await this.contractService.verifyPool();
            await this.contractService.initializeTokenDecimals();
            await this.checkAndApproveTokens();
            console.log('Market maker initialized successfully');
            return true;
        } catch (error) {
            console.error('Failed to initialize market maker:', error);
            return false;
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
                price = await this.contractService.fetchChainlinkPrice();
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

    // Modify the fetchBinancePrice method
    private async fetchBinancePrice(): Promise<bigint> {
        try {
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
            // Convert to 6 decimal format and round to nearest 0.01
            const priceIn6Decimals = Math.round(price * 100) * 10000; // Round to nearest 0.01
            return BigInt(priceIn6Decimals) * 100n; // Convert from 6 decimals to 8 decimals
        } catch (error) {
            console.error('Error fetching price from Binance:', error);
            return 0n;
        }
    }

    private async updateActiveOrders() {
        try {
            const userActiveOrders = await this.contractService.getUserActiveOrders();

            this.activeOrderIds = { [Side.BUY]: [], [Side.SELL]: [] };

            for (const order of userActiveOrders) {
                const formattedOrderPrice = this.contractService.formatPrice(order.price);
                const side = formattedOrderPrice > this.lastMidPrice ? Side.SELL : Side.BUY;
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

        console.log(`Price deviation: ${Number(deviationBps) / 100}% (threshold: ${Number(thresholdBps) / 100}%)`);

        return deviationBps > thresholdBps;
    }

    private async cancelAndReplaceOrders() {
        await this.cancelAllOrders();
        await this.placeMakerOrders();
    }

    private async fillMissingOrders() {
        try {
            // Retrieve current active orders
            const userActiveOrders = await this.contractService.getUserActiveOrders();

            // Count orders by side
            const buyOrders = userActiveOrders.filter(order => order.side === Side.BUY);
            const sellOrders = userActiveOrders.filter(order => order.side === Side.SELL);

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

                    // Format the price before placing the order
                    const formattedBuyPrice = this.roundToNearestPriceIncrement(
                        this.contractService.formatPrice(buyPrice)
                    );
                    await this.placeOrder(Side.BUY, formattedBuyPrice, this.config.orderSize);
                }

                // Add missing sell orders
                for (let i = 0; i < sellOrdersToAdd; i++) {
                    // Calculate position for new order
                    const position = this.config.maxOrdersPerSide - sellOrdersToAdd + i;
                    const totalBasisPoints = spreadBasisPoints + (priceStepBasisPoints * BigInt(position));
                    const sellPrice = this.lastMidPrice + (this.lastMidPrice * totalBasisPoints / 10000n);

                    // Format the price before placing the order
                    const formattedSellPrice = this.roundToNearestPriceIncrement(
                        this.contractService.formatPrice(sellPrice)
                    );
                    await this.placeOrder(Side.SELL, formattedSellPrice, this.config.orderSize);
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
            const userActiveOrders = await this.contractService.getUserActiveOrders();

            for (const order of userActiveOrders) {
                console.log(`Cancelling ${order.side === Side.BUY ? 'buy' : 'sell'} order ${order.id} at price ${formatUnits(order.price, 6)}`);

                await this.contractService.cancelOrder(order.side, order.price, order.id);
            }

            this.activeOrderIds = { [Side.BUY]: [], [Side.SELL]: [] };
            console.log('All orders cancelled');
        } catch (error) {
            console.error('Error cancelling orders:', error);
        }
    }

    // Modify the placeMakerOrders method
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

            // Round to nearest 0.01 USDC
            const formattedBuyPrice = this.roundToNearestPriceIncrement(
                this.contractService.formatPrice(buyPrice)
            );
            await this.placeOrder(Side.BUY, formattedBuyPrice, config.orderSize);
        }

        for (let i = 0; i < this.config.maxOrdersPerSide; i++) {
            const totalBasisPoints = spreadBasisPoints + (priceStepBasisPoints * BigInt(i));
            const sellPrice = this.lastMidPrice + (this.lastMidPrice * totalBasisPoints / 10000n);

            // Round to nearest 0.01 USDC
            const formattedSellPrice = this.roundToNearestPriceIncrement(
                this.contractService.formatPrice(sellPrice)
            );
            await this.placeOrder(Side.SELL, formattedSellPrice, config.orderSize);
        }

        console.log('Maker orders placed');
    }

    private async placeOrder(side: Side, price: bigint, quantity: bigint) {
        try {
            const decimals = this.contractService.getDecimalsForSide(side);

            if (side === Side.BUY) {
                console.log(`Placing buy order at price ${formatUnits(price, this.contractService.quoteDecimals)} with ${formatUnits(quantity, decimals)} quote tokens`);
            } else {
                console.log(`Placing sell order at price ${formatUnits(price, this.contractService.quoteDecimals)} with ${formatUnits(quantity, decimals)} base tokens`);
            }

            const tx = await this.contractService.placeOrder(side, price, quantity);
            console.log(`Order placed, transaction: ${tx}`);
        } catch (error) {
            console.error(`Error placing ${side === Side.BUY ? 'buy' : 'sell'} order:`, error);
        }
    }
}
