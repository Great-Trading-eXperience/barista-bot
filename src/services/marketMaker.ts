import { formatUnits, parseUnits } from 'viem';
import config from '../config/config';
import { Side } from '../types';
import { setup } from "../scripts/setup";
import { ContractService } from './contractService';
import logger from '../utils/logger';

export class MarketMaker {
    private priceRefreshInterval: NodeJS.Timeout | null = null;
    private activeOrderIds: { [side: number]: string[] } = { [Side.BUY]: [], [Side.SELL]: [] };
    private lastMidPrice: bigint = 0n;
    private readonly contractService: ContractService;
    private readonly config;
    private isProcessing: boolean = false;

    constructor() {
        this.config = config;
        this.contractService = new ContractService();
    }

    private convertDecimals(value: bigint, toDecimals: number = 16): bigint {
        // First format the bigint to a string with the original decimals ( set to 18)
        const formattedValue = formatUnits(value, 18);
        
        // Then parse it back to bigint with the target decimals
        return parseUnits(formattedValue, toDecimals)
    }

    private roundToNearestPriceIncrement(price: bigint): bigint {
        const minPriceIncrement = 10000n; // 0.01 USDC in 6 decimal format
        return (price / minPriceIncrement) * minPriceIncrement;
    }

    async initialize() {
        logger.info('Initializing market maker bot...');
        logger.info(`Using network with chainId: ${config.chainId}`);

        try {
            await this.contractService.verifyPool();
            await this.contractService.initializeTokenDecimals();
            await this.checkAndApproveTokens();
            logger.info('Market maker initialized successfully');
            return true;
        } catch (error) {
            logger.error({ error }, 'Failed to initialize market maker');
            return false;
        }
    }

    private async checkAndApproveTokens() {
        try {
            logger.info('Checking token balances and approvals...');

            const setupResult = await setup();

            if (!setupResult) {
                throw new Error('Failed to set up token balances and approvals');
            }

            logger.info('Token balances and allowances verified');
            return true;
        } catch (error) {
            logger.error({ error }, 'Error checking and approving tokens');
            throw error;
        }
    }

    async start() {
        logger.info('Starting market maker bot...');

        await this.cancelAllOrders();
        await this.updateMarketData();

        this.priceRefreshInterval = setInterval(async () => {
            try {
                if (!this.isProcessing) {
                    await this.performMarketMakingCycle();
                } else {
                    logger.info('Previous market making cycle still running, skipping this interval');
                }
            } catch (error) {
                logger.error({ error }, 'Error in market making cycle');
                this.isProcessing = false;
            }
        }, config.refreshInterval);

        await this.performMarketMakingCycle();

        logger.info('Market maker bot running...');
    }

    async stop() {
        logger.info('Stopping market maker bot...');

        if (this.priceRefreshInterval) {
            clearInterval(this.priceRefreshInterval);
            this.priceRefreshInterval = null;
        }

        await this.cancelAllOrders();

        logger.info('Market maker bot stopped');
    }

    private async performMarketMakingCycle() {
        if (this.isProcessing) return;

        this.isProcessing = true;
        logger.debug('Performing market making cycle...');

        try {
            const previousMidPrice = this.lastMidPrice;

            await this.updateMarketData();

            if (previousMidPrice === 0n || this.isPriceDeviationSignificant(previousMidPrice, this.lastMidPrice)) {
                logger.info('Price deviation exceeds threshold, replacing orders');
                await this.cancelAndReplaceOrders();
            } else {
                await this.fillMissingOrders();
            }

            logger.debug('Market making cycle completed');
        } catch (error) {
            logger.error({ error }, 'Error during market making cycle');
        } finally {
            this.isProcessing = false; // Reset the flag when done, regardless of success or failure
        }
    }

    private async updateMarketData() {
        try {
            let price = 0n;

            if (this.config.useBinancePrice) {
                price = await this.fetchBinancePrice();
                if (price > 0n) {
                    logger.info(`Using Binance price: ${formatUnits(price, 8)} USD`);
                }
            }

            // If Binance price failed or is not enabled, try Chainlink as fallback
            if (price === 0n) {
                price = await this.contractService.fetchChainlinkPrice();
                if (price > 0n) {
                    logger.info(`Using Chainlink price: ${formatUnits(price, 8)} USD`);
                }
            }

            if (price === 0n) {
                price = BigInt(this.config.defaultPrice!);
            }

            if (price > 0n) {
                this.lastMidPrice = price;
            }

            await this.updateActiveOrders();
        } catch (error) {
            logger.error({ error }, 'Error updating market data');
        }
    }

    // Modify the fetchBinancePrice method
    private async fetchBinancePrice(): Promise<bigint> {
        try {
            const response = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${this.config.marketPair}`);

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
            logger.error({ error }, 'Error fetching price from Binance');
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

            logger.debug(`Active orders - Buy: ${this.activeOrderIds[Side.BUY].length}, Sell: ${this.activeOrderIds[Side.SELL].length}`);
        } catch (error) {
            logger.error({ error }, 'Error updating active orders');
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

        logger.debug(`Price deviation: ${Number(deviationBps) / 100}% (threshold: ${Number(thresholdBps) / 100}%)`);

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

            logger.debug(`Current orders - Buy: ${buyOrders.length}, Sell: ${sellOrders.length}`);

            // Calculate how many orders to add on each side
            const buyOrdersToAdd = Math.max(0, this.config.maxOrdersPerSide - buyOrders.length);
            const sellOrdersToAdd = Math.max(0, this.config.maxOrdersPerSide - sellOrders.length);

            if (buyOrdersToAdd > 0 || sellOrdersToAdd > 0) {
                logger.info(`Adding missing orders - Buy: ${buyOrdersToAdd}, Sell: ${sellOrdersToAdd}`);

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
                logger.debug('No new orders needed - order book already balanced');
            }
        } catch (error) {
            logger.error({ error }, 'Error filling missing orders');
        }
    }

    private async cancelAllOrders() {
        logger.info('Cancelling all active orders...');

        try {
            const orders = await this.contractService.getUserActiveOrders();

            await Promise.all(orders.map(async (order) => {
                const sideText = order.side === Side.BUY ? 'buy' : 'sell';
                try {
                    logger.debug(`Cancelling ${sideText} order ${order.id}`);
                    await this.contractService.cancelOrder(order.id);
                } catch (error) {
                    logger.error({ error, orderId: order.id }, `Error cancelling order ${order.id}`);
                }
            }));

            this.activeOrderIds = { [Side.BUY]: [], [Side.SELL]: [] };
            logger.info('All orders cancelled');
        } catch (error) {
            logger.error({ error }, 'Error cancelling orders');
        }
    }

    // Modify the placeMakerOrders method
    private async placeMakerOrders() {
        if (this.lastMidPrice === 0n) {
            logger.warn('Cannot place orders: No mid price available');
            return;
        }

        logger.info('Placing maker orders...');

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

        logger.info('Maker orders placed');
    }

    private async placeOrder(side: Side, price: bigint, quantity: bigint) {
        try {
            const decimals = this.contractService.getDecimalsForSide(side);

            if (side === Side.BUY) {
                logger.debug(`Placing buy order at price ${formatUnits(price, this.contractService.quoteDecimals)} with ${formatUnits(quantity, decimals)} quote tokens`);
            } else {
                logger.debug(`Placing sell order at price ${formatUnits(price, this.contractService.quoteDecimals)} with ${formatUnits(quantity, decimals)} base tokens`);
            }

            const tx = await this.contractService.placeOrder(side, price, this.convertDecimals(quantity, decimals));
            logger.debug(`Order placed, transaction: ${tx}`);
        } catch (error) {
            logger.error({ error, side: side === Side.BUY ? 'buy' : 'sell' }, `Error placing ${side === Side.BUY ? 'buy' : 'sell'} order`);
        }
    }
}
