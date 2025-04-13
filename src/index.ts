// barista-bot/src/index.ts
import { BotManager } from './services/botManager';

async function main() {
    process.stdout.write('Starting Barista Bot System\n');

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
                process.stdout.write('Waiting for market maker to establish orders...\n');
                await new Promise(resolve => setTimeout(resolve, 10000));

                // Then start trading bots
                await botManager.startTradingBots();
                break;
        }

        process.stdout.write(`Barista Bot System running in ${mode} mode\n`);
    } catch (error) {
        process.stdout.write(`Unhandled error: ${error}\n`);
        process.exit(1);
    }
}

main();