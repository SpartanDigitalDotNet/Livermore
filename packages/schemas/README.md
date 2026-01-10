# @livermore/schemas

Single source of truth for all Zod schemas and TypeScript types used across the Livermore trading system.

## Overview

This package contains all data validation schemas using [Zod](https://zod.dev/). All TypeScript types are inferred from these schemas, ensuring runtime validation matches compile-time types.

## Structure

```
src/
├── market/            # Market data schemas
│   ├── candle.schema.ts
│   ├── ticker.schema.ts
│   ├── orderbook.schema.ts
│   └── trade.schema.ts
├── indicators/        # Technical indicator schemas
│   ├── base.schema.ts
│   ├── ema.schema.ts
│   ├── macd.schema.ts
│   └── alert.schema.ts
└── env/              # Environment and configuration
    ├── config.schema.ts
    └── features.schema.ts
```

## Usage

```typescript
import { CandleSchema, type Candle } from '@livermore/schemas';

// Validate data at runtime
const candle = CandleSchema.parse(rawData);

// Use inferred TypeScript type
function processCandle(candle: Candle) {
  // TypeScript knows the shape of candle
  console.log(candle.close, candle.volume);
}
```

## Key Schemas

### Market Data
- **CandleSchema**: OHLCV candlestick data
- **TickerSchema**: Real-time price and 24h statistics
- **OrderbookSchema**: Bid/ask orderbook snapshots
- **TradeSchema**: Individual trade executions

### Indicators
- **EMAConfigSchema**: Exponential Moving Average configuration
- **MACDConfigSchema**: MACD indicator configuration
- **AlertConfigSchema**: Alert conditions and triggers

### Environment
- **EnvConfigSchema**: Required environment variables (secrets)
- **FeaturesConfigSchema**: Feature flags from environment.json

## Philosophy

1. **Runtime + Compile-time Safety**: Zod validates at runtime, types are inferred for compile-time
2. **Single Source of Truth**: All packages import from this one package
3. **No Drift**: Changes to schemas automatically update types everywhere
4. **Similar to Protocol Buffers**: Define schema once, use everywhere

## Development

```bash
# Build the package
pnpm build

# Watch mode for development
pnpm dev

# Type checking
pnpm type-check

# Linting
pnpm lint
```
