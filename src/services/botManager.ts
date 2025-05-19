import { MarketMaker } from './marketMaker';
import { TradingBot } from './tradingBot';
import { setup } from '../scripts/setup';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from "dotenv";
import logger from '../utils/logger';
import { updateByCloud } from '../config/config';

dotenv.config();

export class BotManager {
    private marketMaker: MarketMaker | null = null;
    private tradingBots: TradingBot[] = [];
    private configRefreshTimer: NodeJS.Timeout | null = null;
    private readonly CONFIG_REFRESH_INTERVAL = 60 * 1000; // 1 minute in milliseconds
    private loginToken: string | null = null;

    private async login(): Promise<boolean> {
        if (!process.env.CLOUD_ENV_LOGIN_URL || !process.env.CLOUD_ENV_USERNAME || !process.env.CLOUD_ENV_PASSWORD) {
            logger.error('Missing login credentials or login URL');
            return false;
        }

        try {
            const response = await fetch(process.env.CLOUD_ENV_LOGIN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: process.env.CLOUD_ENV_USERNAME,
                    password: process.env.CLOUD_ENV_PASSWORD
                })
            });

            if (!response.ok) {
                logger.error('Login failed:', await response.text());
                return false;
            }

            const data = await response.json();
            if (!data.token) {
                logger.error('No token received from login');
                return false;
            }

            this.loginToken = data.token;
            logger.info('Successfully logged in');
            return true;
        } catch (error) {
            logger.error({ error }, 'Error during login');
            return false;
        }
    }

    public async startConfigRefreshTimer(): Promise<void> {
        // Clear any existing timer
        if (this.configRefreshTimer) {
            clearInterval(this.configRefreshTimer);
        }

        // Try to login first if we don't have a token
        if (!this.loginToken) {
            const loginSuccess = await this.login();
            if (!loginSuccess) {
                logger.error('Failed to login, config refresh timer not started');
                return;
            }
        }

        await this.refreshConfig();
        // Start new timer
        this.configRefreshTimer = setInterval(async () => {
            await this.refreshConfig();
        }, this.CONFIG_REFRESH_INTERVAL);
        
        logger.info('Started config refresh timer');
    }

    private stopConfigRefreshTimer(): void {
        if (this.configRefreshTimer) {
            clearInterval(this.configRefreshTimer);
            this.configRefreshTimer = null;
            logger.info('Stopped config refresh timer');
        }
    }

    async refreshConfig(): Promise<void> {
        let refreshedConfig = null;
        try {
            // If we don't have a token, try to login first
            if (!this.loginToken) {
                const loginSuccess = await this.login();
                if (!loginSuccess) {
                    logger.error('Failed to login during config refresh');
                    return;
                }
            }

            refreshedConfig = await updateByCloud(this.loginToken ?? '');
            if (!refreshedConfig) {
                // If update failed, token might be expired, try to login again
                const loginSuccess = await this.login();
                if (loginSuccess) {
                    refreshedConfig = await updateByCloud(this.loginToken ?? '');
                }
            }
        } catch (error) {
            logger.error({ error }, 'Error refreshing config');
            this.loginToken = null;
            return;
        }

        if (!refreshedConfig) return;
        logger.info('Refreshed config', refreshedConfig);
        this.marketMaker?.updateConfig(refreshedConfig);
        this.tradingBots.forEach(bot => bot.updateConfig(refreshedConfig));
    }
    
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

            logger.info(`${this.tradingBots.length} trading bots running`)
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
        this.stopConfigRefreshTimer(); // Stop the config refresh timer
        
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
