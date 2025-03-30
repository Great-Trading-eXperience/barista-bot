# 🍸 Barista Bot - DEX Market Making & Trading System

## 🌟 Overview

Barista Bot is a TypeScript-based system for market making and automated trading on decentralized exchanges (DEXs). It
provides liquidity and executes trades on pools with ETH/USDC trading pairs.

## 🚀 Features

- 🏦 **Market Making**: Creates and manages a liquidity provision strategy with configurable spread and order book depth
- 🤖 **Trading Bots**: Supports multiple trading strategies including random, momentum, and mean-reversion
- ⚙️ **Configurable**: All parameters can be set through environment variables
- 🔄 **Price Oracle Integration**: Uses Binance API and Chainlink as price sources
- 🔁 **Transaction Handling**: Robust nonce management and transaction queue system
- 🔌 **Multi-Chain Support**: Works with RISE Testnet, Espresso Network, and local development environments

## 🏗️ Architecture

The system consists of several core components:

- `BotManager`: Orchestrates the market maker and trading bots
- `MarketMaker`: Maintains a balanced order book with configurable parameters
- `TradingBot`: Executes trades based on different strategies
- `ContractService`: Handles all blockchain interactions

## 🛠️ Technical Details

### Contract Interactions

- Interacts with a DEX architecture that includes:
    - `PoolManager`: Manages the trading pools
    - `GTXRouter`: Main entry point for order placement and management
    - `BalanceManager`: Handles token deposits and balances

### Price Management

```
Market Price Sources
┌─────────────┐    ┌─────────────┐
│  Binance    │    │  Chainlink  │
│   Price     │    │    Price    │
└──────┬──────┘    └──────┬──────┘
       │                  │
       └──────────┬───────┘
                  ▼
         ┌─────────────────┐
         │  Price Oracle   │
         │    Strategy     │
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────┐
         │  Order Pricing  │
         │     Logic       │
         └─────────────────┘
```

### Trading Strategies

- **Random**: Places buy/sell orders randomly
- **Momentum**: Follows market trends
- **Mean-Reversion**: Trades against market trends

## 💻 Getting Started

### Prerequisites

- Node.js (16+)
- pnpm package manager
- Ethereum wallet with private key

### Installation

```bash
# Clone the repository
git clone <repository-url>

# Install dependencies
pnpm install

# Build the project
pnpm build
```

### Configuration

Create a `.env` file based on the provided sample with:

- Contract addresses
- Private keys
- Market maker parameters
- Chain configuration

### Running

```bash
# Start full system (market maker + trading bots)
pnpm start

# Start only market maker
pnpm start market-maker

# Start only trading bots
pnpm start trading-bots

# Development mode with auto-reload
pnpm dev
```

## 🧪 Testing and Development

The system can be configured to run against:

- Local blockchain (Anvil)
- RISE Testnet
- Espresso Network testnet

## 📊 Performance Considerations

- The transaction queue system prevents nonce errors
- Frequent price updates ensure accurate market representation
- Configurable intervals prevent network congestion