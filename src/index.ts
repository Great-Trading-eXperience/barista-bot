// barista-bot/src/index.ts
import { BotManager } from './services/botManager';

async function main() {
    console.log('Starting Barista Bot System');

    const botManager = new BotManager();

    try {
        // Get command line arguments
        const args = process.argv.slice(2);
        const mode = args[0]?.toLowerCase() || 'all';

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
                console.log('Waiting for market maker to establish orders...');
                await new Promise(resolve => setTimeout(resolve, 10000));

                // Then start trading bots
                await botManager.startTradingBots();
                break;
        }

        console.log(`Barista Bot System running in ${mode} mode`);
    } catch (error) {
        console.error('Unhandled error:', error);
        process.exit(1);
    }
}

main();