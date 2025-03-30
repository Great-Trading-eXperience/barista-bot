import {type Address, formatUnits} from 'viem';
import config from '../config/config';
import {IntervalType, Side} from '../types';
import {ContractService} from './contractService';

export class TradingBot {
    private tradingInterval: NodeJS.Timeout | null = null;
    private strategy: 'random' | 'momentum' | 'mean-reversion';
    private lastPrices: bigint[] = [];
    private contractService: ContractService;
    private intervalType: IntervalType;

    constructor(private account = config.account) {
        const envInterval = (process.env.TRADING_BOT_INTERVAL || 'normal').toLowerCase();

        switch (envInterval) {
            case 'high_freq':
                this.intervalType = IntervalType.HIGH_FREQ;
                break;
            case 'fast':
                this.intervalType = IntervalType.FAST;
                break;
            case 'long':
                this.intervalType = IntervalType.LONG;
                break;
            case 'normal':
            default:
                this.intervalType = IntervalType.NORMAL;
                break;
        }

        this.strategy = "random";
        this.contractService = new ContractService(account);
    }

    randomizeStrategy() {
        const strategies = ['random', 'momentum', 'mean-reversion'];
        const randomIndex = Math.floor(Math.random() * strategies.length);
        console.log(`Using strategy: ${strategies[randomIndex]}`);
        return strategies[randomIndex] as 'random' | 'momentum' | 'mean-reversion';
    }

    async initialize() {
        console.log('Initializing trading bot...');
        return true;
    }

    async start() {
        console.log('Starting trading bot...');

        this.tradingInterval = setInterval(async () => {
            try {
                await this.executeTrade();
            } catch (error) {
                console.error('Error executing trade:', error);
            }
        }, this.getRandomInterval());
    }

    async stop() {
        console.log('Stopping trading bot...');

        if (this.tradingInterval) {
            clearInterval(this.tradingInterval);
            this.tradingInterval = null;
        }

        console.log('Trading bot stopped');
    }

    private getRandomInterval(): number {
        switch (this.intervalType) {
            case IntervalType.HIGH_FREQ:
                return 100; // 100 ms
            case IntervalType.FAST:
                return 2000; // 2 seconds for fast
            case IntervalType.NORMAL:
                // 30 seconds to 2 minutes
                return Math.floor(Math.random() * (120000 - 30000) + 30000);
            case IntervalType.LONG:
                // 3 to 5 minutes
                return Math.floor(Math.random() * (300000 - 180000) + 180000);
            default:
                return 30000; // fallback to 30 seconds
        }
    }

    private async executeTrade() {
        try {
            // Get current price info for strategy determination only
            const currentPrice = await this.getCurrentPrice();
            if (!currentPrice) return;

            this.lastPrices.push(currentPrice);
            if (this.lastPrices.length > 10) this.lastPrices.shift();

            // Determine trade side based on strategy
            const side = await this.determineTradeSide(currentPrice);

            // Calculate trade size (0.01 to 0.05 of config order size)
            const sizeMultiplier = 0.01 + Math.random() * 0.04;
            const quantity = BigInt(Math.floor(Number(config.orderSize) * sizeMultiplier));

            console.log(`Executing ${side === Side.BUY ? 'buy' : 'sell'} trade with quantity ${formatUnits(quantity, 18)}`);

            const depositPrice = await this.contractService.getBestPrice(side === Side.BUY ? Side.SELL : Side.BUY);
            const priceForDeposit = depositPrice.price > 0n ? depositPrice.price : currentPrice;

            await this.contractService.placeMarketOrderWithDeposit(side, priceForDeposit, quantity);
            console.log('Trade executed successfully with deposit');
        } catch (error) {
            console.error('Error executing trade:', error);
        }
    }

    private async getCurrentPrice(): Promise<bigint | null> {
        try {
            const bestBid = await this.contractService.getBestPrice(Side.BUY);
            const bestAsk = await this.contractService.getBestPrice(Side.SELL);

            if (bestBid.price > 0n && bestAsk.price > 0n) {
                return (bestBid.price + bestAsk.price) / 2n;
            } else if (bestBid.price > 0n) {
                return bestBid.price;
            } else if (bestAsk.price > 0n) {
                return bestAsk.price;
            }
            return null;
        } catch (error) {
            console.error('Error getting current price:', error);
            return null;
        }
    }

    private async determineTradeSide(currentPrice: bigint): Promise<Side> {
        switch (this.strategy) {
            case 'random':
                return Math.random() > 0.5 ? Side.BUY : Side.SELL;

            case 'momentum':
                if (this.lastPrices.length < 2) return Math.random() > 0.5 ? Side.BUY : Side.SELL;
                // Follow the trend
                return this.lastPrices[this.lastPrices.length - 1] > this.lastPrices[this.lastPrices.length - 2]
                    ? Side.BUY : Side.SELL;

            case 'mean-reversion':
                if (this.lastPrices.length < 3) return Math.random() > 0.5 ? Side.BUY : Side.SELL;
                // Calculate average price
                const avgPrice = this.lastPrices.reduce((a, b) => a + b, 0n) / BigInt(this.lastPrices.length);
                // Go against the trend
                return currentPrice > avgPrice ? Side.SELL : Side.BUY;

            default:
                return Math.random() > 0.5 ? Side.BUY : Side.SELL;
        }
    }

    getAccountAddress(): Address {
        return this.account.address;
    }
}
