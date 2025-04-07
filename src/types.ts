import { type Address } from 'viem';

export enum Side {
    BUY = 0,
    SELL = 1
}

export interface PoolKey {
    baseCurrency: Address;
    quoteCurrency: Address;
    baseDecimals?: number;
    quoteDecimals?: number;
}

export type PriceVolumeResponse = {
    price: bigint;
    volume: bigint;
};

export type PoolResponse = {
    orderBook: Address;
};

export type OrderResponse = {
    side: Side;
    id: string;
    price: bigint;
    quantity: bigint;
};

export enum IntervalType {
    HIGH_FREQ = 'high_freq',
    FAST = 'fast',
    NORMAL = 'normal',
    LONG = 'long'
}