# Coding Conventions

**Analysis Date:** 2026-01-18

## Naming Patterns

**Files:**
- Kebab-case for source files: `candle-cache.ts`, `alert-evaluation.service.ts`, `macd-v.ts`
- Suffix pattern for services: `*.service.ts` (e.g., `alert-evaluation.service.ts`)
- Suffix pattern for routers: `*.router.ts` (e.g., `indicator.router.ts`)
- Suffix pattern for schemas: `*.schema.ts` (e.g., `candle.schema.ts`)
- Test files: `*.test.ts` in `__tests__` directory

**Functions:**
- camelCase for all functions: `createDbClient()`, `macdVLatest()`, `classifyMACDVStage()`
- Factory pattern prefix: `create*` (e.g., `createLogger()`, `createDbClient()`)
- Getter pattern prefix: `get*` (e.g., `getDbClient()`, `getRedisClient()`)
- Boolean predicates: `is*` or `has*` (e.g., `isEnabled()`, `hasIndicator()`)

**Variables:**
- camelCase for variables: `currentMacdV`, `alertedLevels`, `validProducts`
- SCREAMING_SNAKE_CASE for constants: `MACD_V_DEFAULTS`, `BLACKLISTED_SYMBOLS`, `MIN_POSITION_VALUE_USD`
- Private class properties: no underscore prefix, use TypeScript `private` keyword

**Types:**
- PascalCase for types and interfaces: `CachedIndicatorValue`, `MACDVConfig`, `CoinbaseAccount`
- Suffix pattern for Zod schemas: `*Schema` (e.g., `CandleSchema`, `TimeframeSchema`)
- Re-export inferred types from Zod: `export type Candle = z.infer<typeof CandleSchema>`

**Classes:**
- PascalCase: `AlertEvaluationService`, `CoinbaseRestClient`, `IndicatorCacheStrategy`
- Suffix `Service` for service classes
- Suffix `Strategy` for strategy pattern classes
- Suffix `Client` for API client classes

## Code Style

**Formatting:**
- Tool: Prettier 3.4.2
- Config: `C:\Dev\claude\Livermore\.prettierrc`
- Settings:
  - Semicolons: required
  - Single quotes: yes
  - Trailing commas: ES5 style
  - Print width: 100 characters
  - Tab width: 2 spaces
  - Arrow parens: always
  - End of line: LF

**Linting:**
- Tool: ESLint 9.17.0 with TypeScript ESLint
- Config: `C:\Dev\claude\Livermore\eslint.config.js`
- Key rules:
  - `@typescript-eslint/no-unused-vars`: error (prefix unused with `_`)
  - `@typescript-eslint/no-explicit-any`: error (avoid `any` type)
  - `no-console`: warn (use logger instead, `console.warn/error` allowed)
  - Explicit return types: off (rely on inference)

**TypeScript:**
- Target: ES2022
- Module: ESNext with bundler resolution
- Strict mode: enabled
- No unused locals/parameters: enforced
- No implicit returns: enforced

## Import Organization

**Order:**
1. Node.js built-ins (rare in this codebase)
2. External packages (`zod`, `ioredis`, `fastify`, `drizzle-orm`)
3. Internal workspace packages (`@livermore/*`)
4. Relative imports (`./`, `../`)

**Path Aliases:**
- Workspace packages: `@livermore/utils`, `@livermore/database`, `@livermore/cache`, `@livermore/schemas`, `@livermore/indicators`, `@livermore/charts`, `@livermore/trpc-config`, `@livermore/coinbase-client`
- No tsconfig path aliases within packages; use relative imports

**Example:**
```typescript
import { z } from 'zod';
import { router, publicProcedure } from '@livermore/trpc-config';
import { TimeframeSchema } from '@livermore/schemas';
import { getRedisClient, IndicatorCacheStrategy } from '@livermore/cache';
import { macdVWithStage } from '@livermore/indicators';
```

## Error Handling

**Patterns:**
- Use try/catch for async operations
- Log errors with structured context before re-throwing or returning
- Return `null` for "not found" scenarios, not exceptions
- Service methods return `{ success: boolean; error: string | null; data: T | null }` for tRPC

**Error Logging:**
```typescript
try {
  const response = await this.request('GET', path);
  return response;
} catch (error) {
  logger.error({ error, symbol, timeframe }, 'Failed to fetch candles from Coinbase');
  throw error;
}
```

**Guard Clauses:**
- Use early returns for invalid inputs
- Validate parameters at function start

```typescript
if (period <= 0) {
  throw new Error('SMA period must be positive');
}
if (values.length < period) {
  return [];
}
```

## Logging

**Framework:** Pino with custom wrapper in `@livermore/utils`

**Usage:**
```typescript
import { logger, createLogger } from '@livermore/utils';

// Global logger
logger.info('Server starting...');

// Named logger for module
const moduleLogger = createLogger('indicator-service');
moduleLogger.debug({ symbol, timeframe }, 'Processing candle');
```

**Log Levels:**
- `trace`: Very detailed debugging
- `debug`: Development debugging, context objects
- `info`: Normal operational events
- `warn`: Unexpected but handled situations
- `error`: Failures requiring attention
- `fatal`: Application cannot continue

**Structured Logging:**
- Always pass context as first argument (object), message as second
- Include relevant identifiers: `{ symbol, timeframe, level, price }`

```typescript
logger.info({ count: accounts.length }, 'Fetched Coinbase accounts');
logger.error({ error, channel }, 'Error handling pub/sub message');
```

## Comments

**When to Comment:**
- Complex business logic (e.g., MACD-V stage classification rules)
- Non-obvious calculations or thresholds
- API endpoint documentation
- Public function JSDoc for exported functions

**JSDoc Pattern:**
```typescript
/**
 * Calculate SMA for an array of values
 * @param values - Array of numeric values
 * @param period - Number of periods for the average
 * @returns Array of SMA values (length = values.length - period + 1)
 */
export function sma(values: number[], period: number): number[] {
```

**Inline Comments:**
- Use for explaining "why" not "what"
- Prefix with context: `// SMA(3) of [1,2,3] = 2`

**Section Headers:**
- Use `// ===== Section Name =====` sparingly for long files

## Function Design

**Size:**
- Keep functions focused; extract helper functions for clarity
- Services: 20-100 lines per method typical
- Core algorithms: 30-80 lines

**Parameters:**
- Use options objects for 3+ parameters
- Provide sensible defaults via destructuring

```typescript
export function macdV(
  bars: OHLCWithSynthetic[],
  config: MACDVConfig = {}
): MACDVSeries {
  const {
    fastPeriod = MACD_V_DEFAULTS.fastPeriod,
    slowPeriod = MACD_V_DEFAULTS.slowPeriod,
    // ...
  } = config;
```

**Return Values:**
- Return `null` for missing/not-found (not `undefined`)
- Use explicit return types for public APIs
- Return meaningful result objects with metadata

```typescript
interface MACDVSeries {
  macdV: number[];
  signal: number[];
  histogram: number[];
  seeded: boolean;
  nEff: number;
  reason?: 'Low trading activity';
}
```

## Module Design

**Exports:**
- Barrel files (`index.ts`) for public API
- Export types alongside implementations
- Re-export from subdirectories

```typescript
// packages/indicators/src/index.ts
export { sma, smaLatest, type SMAResult } from './core/sma.js';
export { macdV, macdVLatest, MACD_V_DEFAULTS, type MACDVConfig } from './indicators/macd-v.js';
```

**Barrel File Pattern:**
```typescript
// packages/schemas/src/index.ts
export * from './market/candle.schema';
export * from './market/ticker.schema';
export * from './indicators/macd.schema';
```

## Class Design

**Singleton Pattern:**
- Use for database/Redis clients
- Factory function + module-level variable

```typescript
let dbInstance: Database | null = null;

export function getDbClient(): Database {
  if (!dbInstance) {
    const config = validateEnv();
    dbInstance = createDbClient(config);
  }
  return dbInstance;
}
```

**Service Classes:**
- Constructor takes dependencies
- `start()`/`stop()` lifecycle methods for long-running services
- Private methods for internal logic

## Schema Patterns

**Zod Schema Convention:**
```typescript
export const CandleSchema = z.object({
  timestamp: z.number().int().positive(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  volume: z.number().nonnegative(),
  symbol: z.string().min(1),
  timeframe: TimeframeSchema,
});

export type Candle = z.infer<typeof CandleSchema>;
```

**Drizzle Schema Convention:**
```typescript
export const candles = pgTable(
  'candles',
  {
    id: serial('id').primaryKey(),
    userId: serial('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    // ...
  },
  (table) => ({
    userExchangeIdx: index('candles_user_exchange_idx').on(table.userId, table.exchangeId),
  })
);

export type Candle = typeof candles.$inferSelect;
export type NewCandle = typeof candles.$inferInsert;
```

## Async Patterns

**Async/Await:**
- Always use async/await over raw Promises
- Handle errors in the calling function

**Parallel Operations:**
```typescript
const [accounts, prices] = await Promise.all([
  client.getAccounts(),
  client.getSpotPrices(currencies),
]);
```

**Event Handlers:**
```typescript
this.subscriber.on('message', (channel: string, message: string) => {
  this.handleMessage(channel, message).catch((error) => {
    logger.error({ error, channel }, 'Error handling pub/sub message');
  });
});
```

---

*Convention analysis: 2026-01-18*
