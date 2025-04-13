import { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatUnits, type Address, Account } from 'viem';
import { anvil } from 'viem/chains';
import config, { getChainConfig } from '../config/config';
import { erc20Abi } from '../abis/erc20Abi';

const mockTokenAbi = [
    ...erc20Abi,
    {
        inputs: [
            { internalType: 'address', name: 'to', type: 'address' },
            { internalType: 'uint256', name: 'amount', type: 'uint256' }
        ],
        name: 'mint',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function'
    }
];

const chain = getChainConfig();

export async function setup(account?: Account) {
    const accountToUse = account || config.account;
    process.stdout.write(`Setting up tokens and approvals for account ${accountToUse.address}...\n`);

    const publicClient = createPublicClient({
        chain: chain,
        transport: http(chain.rpcUrls.default.http.toString()),
    });

    const walletClient = createWalletClient({
        chain: chain,
        transport: http(chain.rpcUrls.default.http.toString()),
        account: accountToUse,
    });

    try {
        const baseToken = config.baseToken;
        const quoteToken = config.quoteToken;
        const balanceManagerAddress = config.balanceManagerAddress;

        // Check current balances
        const baseTokenBalance = await getTokenBalance(baseToken, accountToUse.address);
        const quoteTokenBalance = await getTokenBalance(quoteToken, accountToUse.address);

        process.stdout.write(`Current balances for ${accountToUse.address}:\n`);
        process.stdout.write(`- Base token (ETH): ${formatUnits(baseTokenBalance, 18)} ETH\n`);
        process.stdout.write(`- Quote token (USDC): ${formatUnits(quoteTokenBalance, 6)} USDC\n`);

        // Define minimum required balances
        const minBaseBalance = parseEther('100000000000');
        const minQuoteBalance = parseUnits('100000000000', 6);

        // Mint tokens if balance is insufficient
        if (baseTokenBalance < minBaseBalance) {
            process.stdout.write(`Minting ETH to ${accountToUse.address}...\n`);
            const mintBaseAmount = parseEther('100000000000');

            await walletClient.writeContract({
                address: baseToken,
                abi: mockTokenAbi,
                functionName: 'mint',
                args: [accountToUse.address, mintBaseAmount],
            });
        } else {
            process.stdout.write(`Base token balance is sufficient.\n`);
        }

        if (quoteTokenBalance < minQuoteBalance) {
            process.stdout.write(`Minting USDC to ${accountToUse.address}...\n`);
            const mintQuoteAmount = parseUnits('100000000000', 6);

            await walletClient.writeContract({
                address: quoteToken,
                abi: mockTokenAbi,
                functionName: 'mint',
                args: [accountToUse.address, mintQuoteAmount],
            });
        } else {
            process.stdout.write(`Quote token balance is sufficient.\n`);
        }

        // Check current allowances
        const baseAllowance = await getAllowance(baseToken, accountToUse.address, balanceManagerAddress);
        const quoteAllowance = await getAllowance(quoteToken, accountToUse.address, balanceManagerAddress);

        const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const minAllowance = parseEther('1000');

        // Approve tokens if allowance is insufficient
        if (baseAllowance < minAllowance) {
            process.stdout.write(`Approving ETH for balance manager...\n`);
            await walletClient.writeContract({
                address: baseToken,
                abi: erc20Abi,
                functionName: 'approve',
                args: [balanceManagerAddress, maxUint256],
            });
        } else {
            process.stdout.write(`Base token allowance is sufficient.\n`);
        }

        if (quoteAllowance < minAllowance) {
            process.stdout.write(`Approving USDC for balance manager...\n`);
            await walletClient.writeContract({
                address: quoteToken,
                abi: erc20Abi,
                functionName: 'approve',
                args: [balanceManagerAddress, maxUint256],
            });
        } else {
            process.stdout.write(`Quote token allowance is sufficient.\n`);
        }

        process.stdout.write(`Setup completed successfully for ${accountToUse.address}\n`);
        return true;
    } catch (error) {
        process.stdout.write(`Error during setup: ${error}\n`);
        return false;
    }

    async function getTokenBalance(tokenAddress: Address, accountAddress: Address): Promise<bigint> {
        return publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [accountAddress],
        }) as Promise<bigint>;
    }

    async function getAllowance(tokenAddress: Address, ownerAddress: Address, spenderAddress: Address): Promise<bigint> {
        return publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [ownerAddress, spenderAddress],
        }) as Promise<bigint>;
    }
}

// Only run directly when script is executed directly
if (require.main === module) {
    setup()
        .then(() => process.exit(0))
        .catch((error) => {
            process.stdout.write(`Unhandled error in setup: ${error}\n`);
            process.exit(1);
        });
}