// barista-bot/src/index.ts
import { BotManager } from './services/botManager';
import { SummaryService } from './services/summaryService';
import logger from './utils/logger';

async function main() {
    logger.info('Starting Barista Bot System');

    const botManager = new BotManager();

    try {
        // Get command line arguments
        const args = process.argv.slice(2);
        const mode = args[0]?.toLowerCase() || 'all';
        
        const summaryService = new SummaryService();
        // Start the summary service
        await summaryService.start();

        switch (mode) {
            case 'market-maker':
                await botManager.startMarketMaker();
                break;
            case 'trading-bots':
                await botManager.startTradingBots();
                break;
            case 'all':
            default:
                // Start market maker first
                await botManager.startMarketMaker();

                // Wait for market maker to establish some orders
                logger.info('Waiting for market maker to establish orders...');
                await new Promise(resolve => setTimeout(resolve, 10000));

                // Then start trading bots
                await botManager.startTradingBots();
                break;
        }
        
        logger.info(`Barista Bot System running in ${mode} mode`);
    } catch (error) {
        logger.error({ error }, `Unhandled error`);
        process.exit(1);
    }
}

main();