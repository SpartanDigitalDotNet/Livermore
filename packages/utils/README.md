# @livermore/utils

Shared utilities and helper functions for the Livermore trading system.

## Overview

This package provides common utilities used across all Livermore packages and applications:
- **Logger**: Structured logging with Pino
- **Time utilities**: Timeframe conversions and candle calculations
- **Math utilities**: Statistical and financial calculations
- **Validation**: Environment variable validation

## Utilities

### Logger

Structured logging using [Pino](https://getpino.io/):

```typescript
import { createLogger, logger } from '@livermore/utils';

// Use the global logger
logger.info('Application started');
logger.error({ err }, 'An error occurred');

// Create a named logger for specific contexts
const wsLogger = createLogger('websocket');
wsLogger.debug('WebSocket connected');
```

### Time Utilities

Timeframe conversions and candle calculations:

```typescript
import {
  timeframeToMs,
  getCandleTimestamp,
  getNextCandleTimestamp,
  isNewCandle,
} from '@livermore/utils';

// Convert timeframe to milliseconds
const duration = timeframeToMs('1h'); // 3600000

// Get candle timestamp (floored to timeframe boundary)
const candleTs = getCandleTimestamp(Date.now(), '1h');

// Check if new candle started
if (isNewCandle(timestamp, '5m')) {
  console.log('New 5-minute candle!');
}
```

### Math Utilities

Statistical and financial calculations:

```typescript
import {
  mean,
  standardDeviation,
  percentageChange,
  emaAlpha,
  roundTo,
} from '@livermore/utils';

// Calculate average
const avg = mean([1, 2, 3, 4, 5]); // 3

// Calculate percentage change
const change = percentageChange(100, 110); // 10

// EMA smoothing factor
const alpha = emaAlpha(9); // 0.2

// Round to decimal places
const rounded = roundTo(3.14159, 2); // 3.14
```

### Environment Validation

Validate environment variables using Zod schemas:

```typescript
import { validateEnv } from '@livermore/utils';

// Call at application startup
// Exits process if validation fails
const env = validateEnv();

console.log(env.NODE_ENV); // 'development' | 'production' | 'test'
console.log(env.DATABASE_PORT); // number
```

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
