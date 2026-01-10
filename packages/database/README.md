# @livermore/database

Database models, migrations, and client using Drizzle ORM for the Livermore trading system.

## Overview

This package provides:
- Database table schemas using Drizzle ORM
- Type-safe database client
- Migration management
- PostgreSQL connection configuration

## Database Schema

### Tables

- **candles**: OHLCV candlestick data with indexes on symbol, timeframe, and timestamp
- **indicators**: Calculated technical indicator values stored as JSON
- **alerts**: User-defined alert configurations with conditions
- **alert_history**: Log of alert trigger events
- **user_settings**: Key-value store for user preferences

## Usage

### Creating the Database Client

```typescript
import { createDbClient } from '@livermore/database';
import { validateEnv } from '@livermore/utils';

const config = validateEnv();
const db = createDbClient(config);

// Query candles
const recentCandles = await db
  .select()
  .from(candles)
  .where(eq(candles.symbol, 'BTC-USD'))
  .limit(100);
```

### Running Migrations

```bash
# Generate migration files from schema changes
pnpm db:generate

# Apply migrations to database
pnpm db:migrate

# Open Drizzle Studio (database GUI)
pnpm db:studio
```

### Working with the Database

```typescript
import { db, candles, alerts } from '@livermore/database';
import { eq, and, gte } from 'drizzle-orm';

// Insert a candle
await db.insert(candles).values({
  symbol: 'BTC-USD',
  timeframe: '1h',
  timestamp: Date.now(),
  open: '50000',
  high: '51000',
  low: '49500',
  close: '50500',
  volume: '100.5',
});

// Query with conditions
const activeAlerts = await db
  .select()
  .from(alerts)
  .where(
    and(
      eq(alerts.symbol, 'ETH-USD'),
      eq(alerts.isActive, true)
    )
  );

// Update an alert
await db
  .update(alerts)
  .set({ lastTriggeredAt: new Date() })
  .where(eq(alerts.id, alertId));
```

## Environment Variables

Required:
- `DB_CONNECTION_STRING`: PostgreSQL connection string
- `LIVERMORE_DATABASE_NAME`: Database name

## Development

```bash
# Build the package
pnpm build

# Watch mode for development
pnpm dev

# Generate migrations
pnpm generate

# Run migrations
pnpm migrate

# Open Drizzle Studio
pnpm studio
```

## Why Drizzle ORM?

- **Type-safe SQL**: Full TypeScript support with inferred types
- **SQL-like syntax**: Write queries that look like SQL
- **Lightweight**: Minimal runtime overhead
- **Migrations**: Full control over migration files
- **Better DX**: Superior to Prisma for TypeScript inference
