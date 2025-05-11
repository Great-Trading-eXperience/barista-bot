import { createWalletClient, http, createPublicClient } from "viem";
import config, { getChainConfig } from "../config/config";
import logger from "../utils/logger";

export class SummaryService {
    private summaryInterval: number = 86400;
    private totalTransactions: number = -1;
    private balanceAfter: bigint | undefined;
    private balanceBefore: bigint | undefined;
    private gasConsumed: bigint | undefined;
    private walletClient;
    private chainId: number;
    private publicClient;
    private isRunning: boolean = false;
    private intervalId: NodeJS.Timeout | null = null;
    private averageBlockTime: number = 1;

    constructor(private account = config.account, interval = 0, averageBlockTime = 0){
        const chain = getChainConfig();
        
        this.walletClient = createWalletClient({
            chain: chain,
            transport: http(chain.rpcUrls.default.http.toString()),
            account: this.account,
        });
        this.chainId = chain.id;
        this.publicClient = createPublicClient({
            chain: chain,
            transport: http(chain.rpcUrls.default.http.toString()),
        });

        if(interval > 0 ) this.summaryInterval = interval;
        if(averageBlockTime > 0) this.averageBlockTime = averageBlockTime;
    }

    async getBalanceByBlock(block: number): Promise<bigint> { 
        try {
            const balance = await this.publicClient.getBalance({
                address: this.walletClient.account.address,
                blockNumber: BigInt(block)
            });
            return balance;
        } catch (error) {
            logger.error('Error getting balance:');
            logger.error(error);
            return BigInt(0);
        }
    }

    async getTotalTransactions(fromBlock: number, toBlock: number): Promise<number> {
        try {
            // Get nonce at the start block
            const startNonce = await this.publicClient.getTransactionCount({
                address: this.walletClient.account.address,
                blockNumber: BigInt(fromBlock)
            });

            // Get nonce at the end block
            const endNonce = await this.publicClient.getTransactionCount({
                address: this.walletClient.account.address,
                blockNumber: BigInt(toBlock)
            });

            // Calculate total transactions as the difference between nonces
            return endNonce - startNonce;
        } catch (error) {
            logger.error('Error getting transaction count:');
            logger.error(error);
            return 0;
        }
    }

    async getGasConsumed(): Promise<bigint> {
        const finalBalanceBefore:   bigint = this.balanceBefore ?? BigInt(0);
        const finalBalanceAfter:    bigint = this.balanceAfter ?? BigInt(0);
        return BigInt(finalBalanceBefore - finalBalanceAfter);
    }

    async getBlockNumberFromTimestamp(timestamp: number): Promise<number> {
        try {
            const block = await this.publicClient.getBlock({
                blockTag: 'latest'
            });
            
            // Get the timestamp of the latest block
            const latestBlockTimestamp = Number(block.timestamp);
            logger.info(`${latestBlockTimestamp}, ${timestamp}`);
            
            const blocksToSubtract = Math.floor((latestBlockTimestamp - timestamp) / this.averageBlockTime);
            const estimatedBlockNumber = Number(block.number) - blocksToSubtract;

            return estimatedBlockNumber;
        } catch (error) {
            logger.error('Error getting block number from timestamp:');
            logger.error(error);
            return 0;
        }
    }

    async getPreviousBlockNumber(): Promise<number> {
        const currentTimestamp = Math.floor(Date.now() / 1000);
        return this.getBlockNumberFromTimestamp(currentTimestamp - this.summaryInterval);
    }

    async generateReport(): Promise<void> {
        try {
            const currentBlock = await this.publicClient.getBlockNumber();
            const previousBlock = await this.getPreviousBlockNumber();

            // Get balances
            this.balanceAfter = await this.getBalanceByBlock(Number(currentBlock));
            this.balanceBefore = await this.getBalanceByBlock(previousBlock);

            // Get total transactions
            this.totalTransactions = await this.getTotalTransactions(previousBlock, Number(currentBlock));

            // Get gas consumed
            this.gasConsumed = await this.getGasConsumed();

            // Create report object
            const report = {
                timestamp: new Date().toISOString(),
                blockRange: {
                    from: previousBlock,
                    to: Number(currentBlock)
                },
                balance: {
                    before: this.balanceBefore.toString(),
                    after: this.balanceAfter.toString()
                },
                totalTransactions: this.totalTransactions,
                gasConsumed: this.gasConsumed.toString()
            };

            // Save report to file
            const fs = require('fs');
            const path = require('path');
            const reportsDir = path.join(process.cwd(), 'reports');
            
            // Create reports directory if it doesn't exist
            if (!fs.existsSync(reportsDir)) {
                fs.mkdirSync(reportsDir);
            }

            const fileName = `report_${Date.now()}.json`;
            fs.writeFileSync(
                path.join(reportsDir, fileName),
                JSON.stringify(report, null, 2)
            );

            logger.info(`Report generated: ${fileName}`);
        } catch (error) {
            logger.error('Error generating report:');
            logger.error(error);
        }
    }

    async start(): Promise<void> {
        if (this.isRunning) {
            logger.info('Summary service is already running');
            return;
        }

        this.isRunning = true;
        logger.info('Starting summary service...');

        // Generate initial report
        await this.generateReport();

        // Set up interval
        this.intervalId = setInterval(async () => {
            await this.generateReport();
        }, this.summaryInterval * 1000);
    }

    stop(): void {
        if (!this.isRunning) {
            logger.info('Summary service is not running');
            return;
        }

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        logger.info('Summary service stopped');
    }
}