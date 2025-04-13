import { defineChain } from 'viem'

export const rise = defineChain({
    id: 11155931,
    name: 'RISE Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
        default: {
            http: ['https://testnet.riselabs.xyz'],
            webSocket: ['wss://testnet.riselabs.xyz/ws']
        },
    },
    blockExplorers: {
        default: {
            name: 'RISE Explorer',
            url: 'https://testnet.explorer.riselabs.xyz',
        },
    },
    contracts: {
        multicall3: {
            address: '0x4200000000000000000000000000000000000013',  // Using standard L2 multicall address
            blockCreated: 0,
        },
        l2StandardBridge: {
            address: '0x4200000000000000000000000000000000000010',
        },
        l2CrossDomainMessenger: {
            address: '0x4200000000000000000000000000000000000007',
        },
    },
    testnet: true
})

export const espresso = defineChain({
    id: 1020201,
    name: 'GTX Espresso',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
        default: {
            http: ['https://157.173.201.26:8547'],
        },
    },
    blockExplorers: {
        default: {
            name: 'Decaf Espresso',
            url: 'https://explorer.decaf.testnet.espresso.network/',
        },
    }
})

export const anvilDev = defineChain({
    id: 31338,
    name: 'AnvilDev',
    nativeCurrency: {
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH',
    },
    rpcUrls: {
        default: {
            http: ['https://gtx-anvil.bobbyfiando.com'],
        },
    },
})
