import { MarketMaker } from './market-maker';

async function main() {
    console.log('Initializing Barista Market Maker Bot');

    try {
        const marketMaker = new MarketMaker();
        const initialized = await marketMaker.initialize();

        if (initialized) {
            await marketMaker.start();

            process.on('SIGINT', async () => {
                console.log('Received SIGINT, shutting down...');
                await marketMaker.stop();
                process.exit(0);
            });

            process.on('SIGTERM', async () => {
                console.log('Received SIGTERM, shutting down...');
                await marketMaker.stop();
                process.exit(0);
            });
        } else {
            console.error('Failed to initialize market maker');
            process.exit(1);
        }
    } catch (error) {
        console.error('Unhandled error:', error);
        process.exit(1);
    }
}

main();