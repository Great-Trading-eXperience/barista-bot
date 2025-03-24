import { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatUnits, type Address } from 'viem';
import {anvil, arbitrum} from 'viem/chains';
import config from '../config/config';
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

const chain = anvil;

async function setup() {
    console.log('Setting up tokens and approvals for trading...');

    const publicClient = createPublicClient({
        chain: chain,
        transport: http(config.rpcUrl),
    });

    const walletClient = createWalletClient({
        chain: chain,
        transport: http(config.rpcUrl),
        account: config.account,
    });

    try {
        const baseToken = config.baseToken;
        const quoteToken = config.quoteToken;
        const balanceManagerAddress = await getBalanceManagerAddress();

        const baseTokenBalance = await getTokenBalance(baseToken, config.account.address);
        const quoteTokenBalance = await getTokenBalance(quoteToken, config.account.address);

        console.log(`Initial balances:`);
        console.log(`- Base token (ETH): ${formatUnits(baseTokenBalance, 18)} ETH`);
        console.log(`- Quote token (USDC): ${formatUnits(quoteTokenBalance, 6)} USDC`);

        console.log(`Minting 1,000,000 ETH to ${config.account.address}...`);
        const mintBaseAmount = parseEther('1000000');

        await walletClient.writeContract({
            address: baseToken,
            abi: mockTokenAbi,
            functionName: 'mint',
            args: [config.account.address, mintBaseAmount],
        });

        console.log(`Minting 1,000,000,000,000 USDC to ${config.account.address}...`);
        const mintQuoteAmount = parseUnits('1000000000000', 6); // USDC has 6 decimals

        await walletClient.writeContract({
            address: quoteToken,
            abi: mockTokenAbi,
            functionName: 'mint',
            args: [config.account.address, mintQuoteAmount],
        });

        const newBaseBalance = await getTokenBalance(baseToken, config.account.address);
        const newQuoteBalance = await getTokenBalance(quoteToken, config.account.address);

        console.log(`Updated balances after minting:`);
        console.log(`- Base token (ETH): ${formatUnits(newBaseBalance, 18)} ETH`);
        console.log(`- Quote token (USDC): ${formatUnits(newQuoteBalance, 6)} USDC`);

        console.log(`Approving infinite amounts for the balance manager at ${balanceManagerAddress}...`);
        const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

        await walletClient.writeContract({
            address: baseToken,
            abi: erc20Abi,
            functionName: 'approve',
            args: [balanceManagerAddress, maxUint256],
        });
        console.log(`Base token (ETH) approved for the balance manager`);

        await walletClient.writeContract({
            address: quoteToken,
            abi: erc20Abi,
            functionName: 'approve',
            args: [balanceManagerAddress, maxUint256],
        });
        console.log(`Quote token (USDC) approved for the balance manager`);

        const baseAllowance = await getAllowance(baseToken, config.account.address, balanceManagerAddress);
        const quoteAllowance = await getAllowance(quoteToken, config.account.address, balanceManagerAddress);

        console.log(`Current allowances:`);
        console.log(`- Base token (ETH): ${baseAllowance.toString()} (${baseAllowance >= maxUint256 ? 'Infinite' : 'Limited'})`);
        console.log(`- Quote token (USDC): ${quoteAllowance.toString()} (${quoteAllowance >= maxUint256 ? 'Infinite' : 'Limited'})`);

        console.log('Setup completed successfully!');
    } catch (error) {
        console.error('Error during setup:', error);
        throw error;
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

    async function getBalanceManagerAddress(): Promise<Address> {
        return config.balanceManagerAddress;
    }
}

setup()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Unhandled error in setup:', error);
        process.exit(1);
    });