import { type Address, formatEther, formatUnits } from 'viem';
import config from '../config/config';
import { IntervalType, Side } from '../types';
import { ContractService } from './contractService';

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
        process.stdout.write(`Using strategy: ${strategies[randomIndex]}\n`);
        return strategies[randomIndex] as 'random' | 'momentum' | 'mean-reversion';
    }

    async initialize() {
        process.stdout.write('Initializing trading bot...\n');
        await this.contractService.initializeTokenDecimals();

        return true;
    }

    async start() {
        process.stdout.write('Starting trading bot...\n');

        this.tradingInterval = setInterval(async () => {
            try {
                await this.executeTrade();
            } catch (error) {
                process.stdout.write(`Error executing trade: ${error}\n`);
            }
        }, this.getRandomInterval());
    }

    async stop() {
        process.stdout.write('Stopping trading bot...\n');

        if (this.tradingInterval) {
            clearInterval(this.tradingInterval);
            this.tradingInterval = null;
        }

        process.stdout.write('Trading bot stopped\n');
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

            const minMultiplier = 0.01;
            const maxMultiplier = 0.3;
            const randomValue = Math.random() * (maxMultiplier - minMultiplier) + minMultiplier;
            const selectedMultiplier = Math.round(randomValue * 100) / 100;
            const quantity = BigInt(Math.floor(Number(config.orderSize) * selectedMultiplier));

            if (side === Side.BUY) {
                process.stdout.write(`Executing buy order with ${formatEther(quantity)} quote tokens (${selectedMultiplier * 100}% size)\n`);
                await this.contractService.placeMarketOrderWithDeposit(side, quantity);
            } else {
                process.stdout.write(`Executing sell order with ${formatEther(quantity)} base tokens (${selectedMultiplier * 100}% size)\n`);
                await this.contractService.placeMarketOrderWithDeposit(side, quantity);
            }

            process.stdout.write('Trade executed successfully with deposit\n');
        } catch (error) {
            process.stdout.write(`Error executing trade: ${error}\n`);
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
            process.stdout.write(`Error getting current price: ${error}\n`);
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
