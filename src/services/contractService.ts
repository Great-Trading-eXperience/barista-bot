import { type Address, createPublicClient, createWalletClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import config, { getChainConfig, gtxRouterAbi, poolManagerAbi } from '../config/config';
import { OrderResponse, PoolKey, PoolResponse, PriceVolumeResponse, Side } from '../types';

export class ContractService {
    private publicClient;
    private ethClient;
    private walletClient;
    private poolKey: PoolKey;
    private currentNonce: number | null = null;
    private pendingTransactions = 0;
    private transactionQueue: Array<() => Promise<any>> = [];
    private processingQueue = false;
    public baseDecimals: number = 18; // Default, will be updated
    public quoteDecimals: number = 18; // Default, will be updated
    // Standard decimal precision used internally 
    private readonly PRICE_DECIMALS = 8;

    constructor(private account = config.account) {
        const chain = getChainConfig();

        this.publicClient = createPublicClient({
            chain: chain,
            transport: http(chain.rpcUrls.default.http.toString()),
        });

        this.ethClient = createPublicClient({
            chain: mainnet,
            transport: http(config.mainnetRpcUrl),
        });

        this.walletClient = createWalletClient({
            chain: chain,
            transport: http(chain.rpcUrls.default.http.toString()),
            account: this.account,
        });

        if (!config.baseToken || !config.quoteToken) {
            throw new Error("Base token or quote token not defined in config");
        }

        // Initialize pool key without decimals first
        this.poolKey = {
            baseCurrency: config.baseToken as Address,
            quoteCurrency: config.quoteToken as Address,
        };
    }

    getPoolKey(): PoolKey {
        return this.poolKey;
    }

    async verifyPool(): Promise<PoolResponse> {
        try {
            const pool = await this.publicClient.readContract({
                address: config.poolManagerAddress,
                abi: poolManagerAbi,
                functionName: 'getPool',
                args: [this.poolKey],
            });

            return pool as unknown as PoolResponse;
        } catch (error) {
            process.stdout.write(`Error verifying pool: ${error}\n`);
            throw new Error('Pool does not exist');
        }
    }

    async getBestPrice(side: Side): Promise<PriceVolumeResponse> {
        try {
            const result = await this.publicClient.readContract({
                address: config.routerAddress,
                abi: gtxRouterAbi,
                functionName: 'getBestPrice',
                args: [this.poolKey.baseCurrency, this.poolKey.quoteCurrency, side],
            });

            const typedResult = result as unknown as { price: bigint; volume: bigint };
            return {
                price: typedResult.price,
                volume: typedResult.volume
            };
        } catch (error) {
            process.stdout.write(`Error getting best ${side === Side.BUY ? 'bid' : 'ask'} price: ${error}\n`);
            return { price: 0n, volume: 0n };
        }
    }

    async getUserActiveOrders(): Promise<OrderResponse[]> {
        try {
            const userActiveOrders = await this.publicClient.readContract({
                address: config.routerAddress,
                abi: gtxRouterAbi,
                functionName: 'getUserActiveOrders',
                args: [this.poolKey.baseCurrency, this.poolKey.quoteCurrency, this.account.address],
            });

            return userActiveOrders as OrderResponse[];
        } catch (error) {
            process.stdout.write(`Error getting user active orders: ${error}\n`);
            throw error;
        }
    }

    async cancelOrder(orderId: string): Promise<`0x${string}`> {
        return this.queueTransaction(async () => {
            try {
                const orderIdBigInt = BigInt(orderId);

                const tx = await this.executeWithNonce(
                    () => this.walletClient.writeContract({
                        address: config.routerAddress,
                        abi: gtxRouterAbi,
                        functionName: 'cancelOrder',
                        args: [
                            this.poolKey.baseCurrency,
                            this.poolKey.quoteCurrency,
                            orderIdBigInt
                        ],
                    })
                );
                return tx;
            } catch (error) {
                process.stdout.write(`Error cancelling order: ${error}\n`);
                throw error;
            }
        });
    }

    async placeOrder(side: Side, price: bigint, quantity: bigint): Promise<`0x${string}`> {
        return this.queueTransaction(async () => {
            try {
                const tx = await this.executeWithNonce(
                    () => this.walletClient.writeContract({
                        address: config.routerAddress,
                        abi: gtxRouterAbi,
                        functionName: 'placeOrderWithDeposit',
                        args: [
                            this.poolKey.baseCurrency,
                            this.poolKey.quoteCurrency,
                            price,
                            quantity,
                            side,
                            this.account.address
                        ],
                    })
                );
                return tx;
            } catch (error) {
                process.stdout.write(`Error placing ${side === Side.BUY ? 'buy' : 'sell'} order: ${error}\n`);
                throw error;
            }
        });
    }

    async placeMarketOrder(side: Side, quantity: bigint): Promise<`0x${string}`> {
        return this.queueTransaction(async () => {
            try {
                const tx = await this.executeWithNonce(
                    () => this.walletClient.writeContract({
                        address: config.routerAddress,
                        abi: gtxRouterAbi,
                        functionName: 'placeMarketOrder',
                        args: [
                            this.poolKey.baseCurrency,
                            this.poolKey.quoteCurrency,
                            quantity,
                            side,
                            this.account.address
                        ],
                    })
                );
                return tx;
            } catch (error) {
                process.stdout.write(`Error placing market order: ${error}\n`);
                throw error;
            }
        });
    }

    async placeMarketOrderWithDeposit(side: Side, quantity: bigint): Promise<`0x${string}`> {
        return this.queueTransaction(async () => {
            try {
                const tx = await this.executeWithNonce(
                    () => this.walletClient.writeContract({
                        address: config.routerAddress,
                        abi: gtxRouterAbi,
                        functionName: 'placeMarketOrderWithDeposit',
                        args: [
                            this.poolKey.baseCurrency,
                            this.poolKey.quoteCurrency,
                            quantity,
                            side,
                            this.account.address
                        ],
                    })
                );
                return tx;
            } catch (error) {
                process.stdout.write(`Error placing market order with deposit: ${error}\n`);
                throw error;
            }
        });
    }

    async fetchChainlinkPrice(): Promise<bigint> {
        try {
            const chainlinkFeed = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
            const response = await this.ethClient.readContract({
                address: chainlinkFeed as Address,
                abi: [
                    {
                        inputs: [],
                        name: 'latestRoundData',
                        outputs: [
                            { name: 'roundId', type: 'uint80' },
                            { name: 'answer', type: 'int256' },
                            { name: 'startedAt', type: 'uint256' },
                            { name: 'updatedAt', type: 'uint256' },
                            { name: 'answeredInRound', type: 'uint80' }
                        ],
                        stateMutability: 'view',
                        type: 'function'
                    }
                ],
                functionName: 'latestRoundData'
            });

            const [, price, , updatedAt] = response;
            const stalePriceThreshold = 3600; // 1 hour
            const timestamp = Math.floor(Date.now() / 1000);

            if (timestamp - Number(updatedAt) > stalePriceThreshold) {
                throw new Error('Chainlink price is stale');
            }

            return BigInt(price);
        } catch (error) {
            process.stdout.write(`Error fetching price from Chainlink: ${error}\n`);
            return 0n;
        }
    }

    // New methods for transaction handling with nonce management

    private async queueTransaction<T>(txFunc: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.transactionQueue.push(async () => {
                try {
                    const result = await txFunc();
                    resolve(result);
                    return result;
                } catch (error) {
                    reject(error);
                    throw error;
                }
            });

            this.processQueue();
        });
    }

    private async processQueue() {
        if (this.processingQueue || this.transactionQueue.length === 0) return;

        this.processingQueue = true;

        try {
            // Get next transaction from queue
            const txFunc = this.transactionQueue.shift();
            if (txFunc) {
                await txFunc();
            }
        } catch (error) {
            process.stdout.write(`Error processing transaction queue: ${error}\n`);
        } finally {
            this.processingQueue = false;

            // Process next transaction in queue if available
            if (this.transactionQueue.length > 0) {
                // Add a small delay before processing the next transaction
                setTimeout(() => this.processQueue(), 100);
            }
        }
    }

    private async executeWithNonce<T>(
        transaction: () => Promise<T>,
        retries = 5
    ): Promise<T> {
        if (this.currentNonce === null) {
            // Get the current nonce for this account
            this.currentNonce = await this.publicClient.getTransactionCount({
                address: this.account.address,
            });
            process.stdout.write(`Initial nonce for ${this.account.address}: ${this.currentNonce}\n`);
        }

        let attempt = 0;
        let lastError;

        while (attempt < retries) {
            try {
                const result = await transaction();
                // Increment nonce after successful transaction
                this.currentNonce++;
                this.pendingTransactions++;

                // Update nonce from network after several transactions to avoid drift
                if (this.pendingTransactions >= 5) {
                    setTimeout(async () => {
                        try {
                            const networkNonce = await this.publicClient.getTransactionCount({
                                address: this.account.address,
                            });
                            if (this.currentNonce !== null && networkNonce > this.currentNonce) {
                                process.stdout.write(`Syncing nonce from ${this.currentNonce} to network nonce ${networkNonce}\n`);
                                this.currentNonce = networkNonce;
                            }
                            this.pendingTransactions = 0;
                        } catch (e) {
                            process.stdout.write(`Error updating nonce from network: ${e}\n`);
                        }
                    }, 2000); // Wait a bit for transactions to propagate
                }

                return result;
            } catch (error: any) {
                lastError = error;
                const errorMsg = error.message || String(error);

                // If it's a nonce-related error
                if (
                    errorMsg.includes("nonce") ||
                    errorMsg.includes("replacement transaction underpriced") ||
                    errorMsg.includes("already known")
                ) {
                    process.stdout.write(`Nonce issue detected (attempt ${attempt + 1}/${retries}): ${errorMsg}\n`);

                    // Update nonce from the network
                    try {
                        const networkNonce = await this.publicClient.getTransactionCount({
                            address: this.account.address,
                        });
                        process.stdout.write(`Current nonce: ${this.currentNonce}, Network nonce: ${networkNonce}\n`);
                        this.currentNonce = networkNonce;
                    } catch (e) {
                        process.stdout.write(`Error fetching network nonce: ${e}\n`);
                    }

                    // Exponential backoff
                    const delay = Math.pow(2, attempt) * 1000;
                    process.stdout.write(`Retrying in ${delay}ms...\n`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    attempt++;
                } else {
                    // If it's not a nonce issue, just throw the error
                    process.stdout.write(`Transaction error (not nonce-related): ${error}\n`);
                    throw error;
                }
            }
        }

        // If we've exhausted all retries
        process.stdout.write(`Failed after ${retries} attempts. Last error: ${lastError}\n`);
        throw lastError;
    }

    // Add method to fetch token decimals
    async getTokenDecimals(tokenAddress: Address): Promise<number> {
        try {
            const decimals = await this.publicClient.readContract({
                address: tokenAddress,
                abi: [{
                    inputs: [],
                    name: 'decimals',
                    outputs: [{ type: 'uint8', name: '' }],
                    stateMutability: 'view',
                    type: 'function'
                }],
                functionName: 'decimals',
            });
            return Number(decimals);
        } catch (error) {
            process.stdout.write(`Error fetching decimals for token ${tokenAddress}: ${error}\n`);
            return 18; // Default to 18 if there's an error
        }
    }

    // Initialize token decimals
    async initializeTokenDecimals(): Promise<void> {
        this.baseDecimals = await this.getTokenDecimals(this.poolKey.baseCurrency);
        this.quoteDecimals = await this.getTokenDecimals(this.poolKey.quoteCurrency);

        process.stdout.write(`Initialized token decimals - Base: ${this.baseDecimals}, Quote: ${this.quoteDecimals}\n`);
    }

    // Get decimals based on side
    getDecimalsForSide(side: Side): number {
        return side === Side.BUY ? this.quoteDecimals : this.baseDecimals;
    }

    // Format price using quote token decimals
    formatPrice(price: bigint): bigint {
        if (this.quoteDecimals === this.PRICE_DECIMALS) return price;

        if (this.quoteDecimals < this.PRICE_DECIMALS) {
            return price / BigInt(10 ** (this.PRICE_DECIMALS - this.quoteDecimals));
        } else {
            return price * BigInt(10 ** (this.quoteDecimals - this.PRICE_DECIMALS));
        }
    }
}
