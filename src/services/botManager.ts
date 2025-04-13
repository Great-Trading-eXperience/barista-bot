import { MarketMaker } from './marketMaker';
import { TradingBot } from './tradingBot';
import { setup } from '../scripts/setup';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from "dotenv";

dotenv.config();

export class BotManager {
    private marketMaker: MarketMaker | null = null;
    private tradingBots: TradingBot[] = [];

    async startMarketMaker(): Promise<void> {
        process.stdout.write('Starting Market Maker\n');

        try {
            this.marketMaker = new MarketMaker();
            const isInitiated = await this.marketMaker.initialize();

            if (!isInitiated) {
                throw new Error('Failed to initialize market maker');
            }

            await this.marketMaker.start();

            process.stdout.write('Market maker started and providing liquidity\n');
            this.setupShutdownHandlers();

            return Promise.resolve();
        } catch (error) {
            process.stdout.write(`Error starting market maker: ${error}\n`);
            throw error;
        }
    }

    async startTradingBots(): Promise<void> {
        process.stdout.write('Starting Trading Bots\n');

        try {
            const botAccounts = [];
            let index = 1;

            // Dynamically load bot private keys from .env file
            while (process.env[`PRIVATE_KEY_TRADER_BOT_${index}`]) {
                const privateKey = process.env[`PRIVATE_KEY_TRADER_BOT_${index}`] as `0x${string}`;
                if (privateKey) {
                    botAccounts.push(privateKeyToAccount(privateKey));
                    index++;
                } else {
                    break;
                }
            }

            if (botAccounts.length === 0) {
                process.stdout.write('No trading bot private keys found in .env file\n');
                return Promise.resolve();
            }

            // Setup and start each trading bot
            for (const account of botAccounts) {
                process.stdout.write(`Setting up trading bot for account ${account.address}\n`);

                // Run setup for this account
                await setup(account);

                // Create and initialize trading bot
                const tradingBot = new TradingBot(account);
                await tradingBot.initialize();
                await tradingBot.start();

                this.tradingBots.push(tradingBot);
                process.stdout.write(`Trading bot started for account ${account.address}\n`);

                // Small delay between starting bots
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            process.stdout.write(`${this.tradingBots.length} trading bots running\n`);
            this.setupShutdownHandlers();

            return Promise.resolve();
        } catch (error) {
            process.stdout.write(`Error starting trading bots: ${error}\n`);
            throw error;
        }
    }

    private setupShutdownHandlers(): void {
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            process.stdout.write('Received SIGINT, shutting down...\n');
            await this.shutdown();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            process.stdout.write('Received SIGTERM, shutting down...\n');
            await this.shutdown();
            process.exit(0);
        });
    }

    private async shutdown(): Promise<void> {
        // Stop all trading bots
        for (const bot of this.tradingBots) {
            process.stdout.write(`Stopping bot for account ${bot.getAccountAddress()}\n`);
            await bot.stop();
        }

        // Stop market maker if it's running
        if (this.marketMaker) {
            process.stdout.write('Stopping market maker\n');
            await this.marketMaker.stop();
        }
    }
}
