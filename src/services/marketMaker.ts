import { formatUnits } from 'viem';
import config from '../config/config';
import { Side } from '../types';
import { setup } from "../scripts/setup";
import { ContractService } from './contractService';

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

    private roundToNearestPriceIncrement(price: bigint): bigint {
        const minPriceIncrement = 10000n; // 0.01 USDC in 6 decimal format
        return (price / minPriceIncrement) * minPriceIncrement;
    }

    async initialize() {
        process.stdout.write('Initializing market maker bot...\n');
        process.stdout.write(`Using network with chainId: ${config.chainId}\n`);

        try {
            await this.contractService.verifyPool();
            await this.contractService.initializeTokenDecimals();
            await this.checkAndApproveTokens();
            process.stdout.write('Market maker initialized successfully\n');
            return true;
        } catch (error) {
            process.stdout.write(`Failed to initialize market maker: ${error}\n`);
            return false;
        }
    }

    private async checkAndApproveTokens() {
        try {
            process.stdout.write('Checking token balances and approvals...\n');

            const setupResult = await setup();

            if (!setupResult) {
                throw new Error('Failed to set up token balances and approvals');
            }

            process.stdout.write('Token balances and allowances verified\n');
            return true;
        } catch (error) {
            process.stdout.write(`Error checking and approving tokens: ${error}\n`);
            throw error;
        }
    }

    async start() {
        process.stdout.write('Starting market maker bot...\n');

        await this.cancelAllOrders();
        await this.updateMarketData();

        this.priceRefreshInterval = setInterval(async () => {
            try {
                if (!this.isProcessing) {
                    await this.performMarketMakingCycle();
                } else {
                    process.stdout.write('Previous market making cycle still running, skipping this interval\n');
                }
            } catch (error) {
                process.stdout.write(`Error in market making cycle: ${error}\n`);
                this.isProcessing = false;
            }
        }, config.refreshInterval);

        await this.performMarketMakingCycle();

        process.stdout.write('Market maker bot running...\n');
    }

    async stop() {
        process.stdout.write('Stopping market maker bot...\n');

        if (this.priceRefreshInterval) {
            clearInterval(this.priceRefreshInterval);
            this.priceRefreshInterval = null;
        }

        await this.cancelAllOrders();

        process.stdout.write('Market maker bot stopped\n');
    }

    private async performMarketMakingCycle() {
        if (this.isProcessing) return;

        this.isProcessing = true;
        process.stdout.write('Performing market making cycle...\n');

        try {
            const previousMidPrice = this.lastMidPrice;

            await this.updateMarketData();

            if (previousMidPrice === 0n || this.isPriceDeviationSignificant(previousMidPrice, this.lastMidPrice)) {
                process.stdout.write('Price deviation exceeds threshold, replacing orders\n');
                await this.cancelAndReplaceOrders();
            } else {
                await this.fillMissingOrders();
            }

            process.stdout.write('Market making cycle completed\n');
        } catch (error) {
            process.stdout.write(`Error during market making cycle: ${error}\n`);
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
                    process.stdout.write(`Using Binance price: ${formatUnits(price, 8)} USD\n`);
                }
            }

            // If Binance price failed or is not enabled, try Chainlink as fallback
            if (price === 0n) {
                price = await this.contractService.fetchChainlinkPrice();
                if (price > 0n) {
                    process.stdout.write(`Using Chainlink price: ${formatUnits(price, 8)} USD\n`);
                }
            }

            if (price > 0n) {
                this.lastMidPrice = price;
            }

            await this.updateActiveOrders();
        } catch (error) {
            process.stdout.write(`Error updating market data: ${error}\n`);
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
            process.stdout.write(`Error fetching price from Binance: ${error}\n`);
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

            process.stdout.write(`Active orders - Buy: ${this.activeOrderIds[Side.BUY].length}, Sell: ${this.activeOrderIds[Side.SELL].length}\n`);
        } catch (error) {
            process.stdout.write(`Error updating active orders: ${error}\n`);
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

        process.stdout.write(`Price deviation: ${Number(deviationBps) / 100}% (threshold: ${Number(thresholdBps) / 100}%)\n`);

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

            process.stdout.write(`Current orders - Buy: ${buyOrders.length}, Sell: ${sellOrders.length}\n`);

            // Calculate how many orders to add on each side
            const buyOrdersToAdd = Math.max(0, this.config.maxOrdersPerSide - buyOrders.length);
            const sellOrdersToAdd = Math.max(0, this.config.maxOrdersPerSide - sellOrders.length);

            if (buyOrdersToAdd > 0 || sellOrdersToAdd > 0) {
                process.stdout.write(`Adding missing orders - Buy: ${buyOrdersToAdd}, Sell: ${sellOrdersToAdd}\n`);

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
                process.stdout.write('No new orders needed - order book already balanced\n');
            }
        } catch (error) {
            process.stdout.write(`Error filling missing orders: ${error}\n`);
        }
    }

    private async cancelAllOrders() {
        process.stdout.write('Cancelling all active orders...\n');

        try {
            const orders = await this.contractService.getUserActiveOrders();

            await Promise.all(orders.map(async (order) => {
                const sideText = order.side === Side.BUY ? 'buy' : 'sell';
                try {
                    process.stdout.write(`Cancelling ${sideText} order ${order.id}\n`);
                    await this.contractService.cancelOrder(order.id);
                } catch (error) {
                    process.stdout.write(`Error cancelling order ${order.id}: ${error}\n`);
                }
            }));

            this.activeOrderIds = { [Side.BUY]: [], [Side.SELL]: [] };
            process.stdout.write('All orders cancelled\n');
        } catch (error) {
            process.stdout.write(`Error cancelling orders: ${error}\n`);
        }
    }

    // Modify the placeMakerOrders method
    private async placeMakerOrders() {
        if (this.lastMidPrice === 0n) {
            process.stdout.write('Cannot place orders: No mid price available\n');
            return;
        }

        process.stdout.write('Placing maker orders...\n');

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

        process.stdout.write('Maker orders placed\n');
    }

    private async placeOrder(side: Side, price: bigint, quantity: bigint) {
        try {
            const decimals = this.contractService.getDecimalsForSide(side);

            if (side === Side.BUY) {
                process.stdout.write(`Placing buy order at price ${formatUnits(price, this.contractService.quoteDecimals)} with ${formatUnits(quantity, decimals)} quote tokens\n`);
            } else {
                process.stdout.write(`Placing sell order at price ${formatUnits(price, this.contractService.quoteDecimals)} with ${formatUnits(quantity, decimals)} base tokens\n`);
            }

            const tx = await this.contractService.placeOrder(side, price, quantity);
            process.stdout.write(`Order placed, transaction: ${tx}\n`);
        } catch (error) {
            process.stdout.write(`Error placing ${side === Side.BUY ? 'buy' : 'sell'} order: ${error}\n`);
        }
    }
}
