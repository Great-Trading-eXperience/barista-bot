import { type Address } from 'viem';

export enum Side {
    BUY = 0,
    SELL = 1
}

export type PoolKey = {
    baseCurrency: Address;
    quoteCurrency: Address;
};

export type PriceVolumeResponse = {
    price: bigint;
    volume: bigint;
};

export type PoolResponse = {
    orderBook: Address;
};

export type OrderResponse = {
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