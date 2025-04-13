import { MarketMaker } from './marketMaker';
import { TradingBot } from './tradingBot';
import { setup } from '../scripts/setup';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from "dotenv";
import logger from '../utils/logger';

dotenv.config();

export class BotManager {
    private marketMaker: MarketMaker | null = null;
    private tradingBots: TradingBot[] = [];

    async startMarketMaker(): Promise<void> {
        logger.info('Starting Market Maker');

        try {
            this.marketMaker = new MarketMaker();
            const isInitiated = await this.marketMaker.initialize();

            if (!isInitiated) {
                throw new Error('Failed to initialize market maker');
            }

            await this.marketMaker.start();

            logger.info('Market maker started and providing liquidity');
            this.setupShutdownHandlers();

            return Promise.resolve();
        } catch (error) {
            logger.error({ error }, 'Error starting market maker');
            throw error;
        }
    }

    async startTradingBots(): Promise<void> {
        logger.info('Starting Trading Bots');

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
                logger.info('No trading bot private keys found in .env file');
                return Promise.resolve();
            }

            // Setup and start each trading bot
            for (const account of botAccounts) {
                logger.info(`Setting up trading bot for account ${account.address}`);

                // Run setup for this account
                await setup(account);

                // Create and initialize trading bot
                const tradingBot = new TradingBot(account);
                await tradingBot.initialize();
                await tradingBot.start();

                this.tradingBots.push(tradingBot);
                logger.info(`Trading bot started for account ${account.address}`);

                // Small delay between starting bots
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            logger.info(`${this.tradingBots.length} trading bots running`);
            this.setupShutdownHandlers();

            return Promise.resolve();
        } catch (error) {
            logger.error({ error }, 'Error starting trading bots');
            throw error;
        }
    }

    private setupShutdownHandlers(): void {
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            logger.warn('Received SIGINT, shutting down...');
            await this.shutdown();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            logger.warn('Received SIGTERM, shutting down...');
            await this.shutdown();
            process.exit(0);
        });
    }

    private async shutdown(): Promise<void> {
        // Stop all trading bots
        for (const bot of this.tradingBots) {
            logger.info(`Stopping bot for account ${bot.getAccountAddress()}`);
            await bot.stop();
        }

        // Stop market maker if it's running
        if (this.marketMaker) {
            logger.info('Stopping market maker');
            await this.marketMaker.stop();
        }
    }
}
