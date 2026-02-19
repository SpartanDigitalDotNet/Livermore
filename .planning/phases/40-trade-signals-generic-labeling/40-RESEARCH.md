# Phase 40: Trade Signals with Generic Labeling - Research

**Researched:** 2026-02-18
**Domain:** REST API endpoint design, data transformation, IP protection
**Confidence:** HIGH

## Summary

Phase 40 adds two new public API endpoints to the existing `@livermore/public-api` package built in Phase 39: a signals endpoint (`GET /public/v1/signals/:exchange/:symbol`) and an alerts history endpoint (`GET /public/v1/alerts`). The core challenge is mapping proprietary MACD-V indicator data to generic labels (`momentum_signal`, `trend_signal`) without leaking indicator names, calculation parameters, or internal metric names.

The codebase already has all data sources required: indicator values are cached in Redis as `CachedIndicatorValue` objects (key: `indicator:{exchangeId}:{symbol}:{timeframe}:macd-v`) containing `macdV`, `signal`, `histogram`, `fastEMA`, `slowEMA`, `atr` in the `value` field, plus `stage`, `seeded`, `nEff`, etc. in the `params` field. Alert history is stored in PostgreSQL (`alert_history` table) with `alert_type='macdv'`, `trigger_label` (e.g., `level_-150`, `reversal_overbought`), `price`, `details` JSONB, and `triggered_at`.

**Primary recommendation:** Follow the exact Phase 39 patterns -- explicit-whitelist transformers, Zod schemas for response validation, direct Redis/DB access (no userId dependency), in-memory exchange name cache, and the same envelope/pagination infrastructure.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastify | ^5.2.2 | HTTP framework | Already used in Phase 39 plugin |
| fastify-type-provider-zod | ^4.0.2 | Schema validation + OpenAPI generation | Already wired in plugin.ts |
| zod | ^3.24.1 | Runtime schema validation | Already used for all public schemas |
| drizzle-orm | ^0.36.4 | Database queries for alert_history | Already a dependency |
| @livermore/cache | workspace:* | Redis access for indicator data | Already a dependency |
| @livermore/database | workspace:* | Database access for alert_history | Already a dependency |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @livermore/schemas | workspace:* | Internal type definitions (Candle, Timeframe) | Type references only |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct Redis GET for indicators | IndicatorCacheStrategy class | Strategy class requires userId param (legacy). Direct `redis.get(exchangeIndicatorKey(...))` avoids userId dependency -- consistent with Phase 39's candle pattern |
| Direct DB query for alerts | Creating a new service class | Service class is overkill for a simple paginated SELECT. Direct drizzle query in route handler follows Phase 39 symbols.route.ts pattern |

**Installation:**
No new dependencies needed. All libraries already in `@livermore/public-api/package.json`.

## Architecture Patterns

### Recommended Project Structure
```
packages/public-api/src/
  schemas/
    signal.schema.ts           # NEW: PublicSignalSchema, SignalParamsSchema, SignalQuerySchema
    alert.schema.ts            # NEW: PublicAlertSchema, AlertQuerySchema
    index.ts                   # MODIFIED: add new exports
  transformers/
    signal.transformer.ts      # NEW: transformIndicatorToSignal()
    alert.transformer.ts       # NEW: transformAlertHistory()
    index.ts                   # MODIFIED: add new exports
  routes/
    signals.route.ts           # NEW: GET /signals/:exchange/:symbol
    alerts.route.ts            # NEW: GET /alerts
    index.ts                   # MODIFIED: add new exports
  plugin.ts                    # MODIFIED: register new routes + OpenAPI tags
```

### Pattern 1: Generic Signal Mapping (CRITICAL IP PROTECTION)

**What:** Map internal MACD-V indicator data to generic signal types that reveal direction and strength but NOT the underlying indicator.

**When to use:** For the signals endpoint -- transforming `CachedIndicatorValue` from Redis.

**Mapping design:**

```typescript
// INTERNAL (from Redis CachedIndicatorValue)
// value: { macdV: 145.2, signal: 130.1, histogram: 15.1, fastEMA, slowEMA, atr }
// params: { stage: 'rallying', seeded: true, ... }

// PUBLIC (generic labels)
{
  type: 'momentum_signal',          // Generic: does NOT reveal MACD-V
  direction: 'bullish',             // Derived from stage
  strength: 'strong',              // Derived from MACD-V magnitude
  timeframe: '15m',
  updated_at: '2026-02-18T12:00:00.000Z'
}
```

**Stage-to-direction mapping:**
| Internal Stage | Public Direction |
|----------------|------------------|
| rallying | bullish |
| rebounding | bullish |
| overbought | bullish (extreme) |
| retracing | bearish |
| reversing | bearish |
| oversold | bearish (extreme) |
| ranging | neutral |
| unknown | neutral |

**Strength derivation (from MACD-V absolute value):**
| MACD-V Range | Public Strength |
|--------------|-----------------|
| abs >= 150 | extreme |
| abs >= 80 | strong |
| abs >= 30 | moderate |
| abs < 30 | weak |

**Signal types:**
- `momentum_signal` - Derived from MACD-V stage/histogram direction (primary signal)
- `trend_signal` - Derived from overall bias across timeframes (multi-timeframe composite)

### Pattern 2: Alert History Transformation

**What:** Query alert_history table and strip MACD-V-specific details.

**Internal alert_history columns -> Public fields:**
| Internal Column | Public Field | Transform |
|----------------|--------------|-----------|
| triggered_at | timestamp | ISO 8601 string |
| symbol | symbol | Pass through |
| exchange_id | exchange | Resolve to exchange name via cache |
| timeframe | timeframe | Pass through |
| alert_type ('macdv') | signal_type | Map to 'momentum_signal' |
| trigger_label | direction | Parse: 'level_-150' -> 'bearish', 'reversal_overbought' -> 'bearish' |
| trigger_value (macdV) | strength | Map absolute value to 'weak'/'moderate'/'strong'/'extreme' |
| price | price | String decimal format |
| details JSONB | (STRIPPED) | NOT exposed -- contains indicator specifics |

**trigger_label parsing:**
- `level_{negative}` (e.g., `level_-150`, `level_-200`) -> direction: `bearish`
- `level_{positive}` (e.g., `level_150`, `level_200`) -> direction: `bullish`
- `reversal_oversold` -> direction: `bullish` (reversing FROM oversold = bullish reversal)
- `reversal_overbought` -> direction: `bearish` (reversing FROM overbought = bearish reversal)

### Pattern 3: Reuse Existing Infrastructure

**What:** Reuse Phase 39 components: `createEnvelopeSchema`, `buildPaginationMeta`, `encodeCursor`/`decodeCursor`, `resolveExchangeId` pattern, error handler.

**Example -- Signals route skeleton:**
```typescript
// Source: follows pattern from packages/public-api/src/routes/candles.route.ts
export const signalsRoute: FastifyPluginAsyncZod = async (fastify) => {
  const redis = getRedisClient();
  const db = getDbClient();
  const exchangeCache = new Map<string, number>(); // Same pattern as candles.route.ts

  async function resolveExchangeId(name: string): Promise<number | null> { /* same as candles */ }

  fastify.get('/:exchange/:symbol', {
    schema: {
      description: '...',
      tags: ['Signals'],
      params: SignalParamsSchema,
      querystring: SignalQuerySchema,
      response: { 200: createEnvelopeSchema(z.array(PublicSignalSchema)) },
    },
  }, async (request, reply) => {
    // 1. Resolve exchange name -> ID
    // 2. Query Redis for indicator values across timeframes
    // 3. Transform to generic signals via explicit whitelist
    // 4. Return envelope response
  });
};
```

### Pattern 4: Direct Redis Access for Indicators (No userId)

**What:** Read indicator data directly from Redis using `exchangeIndicatorKey()` without IndicatorCacheStrategy (which requires userId).

**Redis key pattern:** `indicator:{exchangeId}:{symbol}:{timeframe}:macd-v`

**Example:**
```typescript
import { getRedisClient, exchangeIndicatorKey } from '@livermore/cache';
import type { Timeframe } from '@livermore/schemas';

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d'];

async function getSignals(exchangeId: number, symbol: string) {
  const redis = getRedisClient();
  const signals = [];

  for (const tf of TIMEFRAMES) {
    const key = exchangeIndicatorKey(exchangeId, symbol, tf, 'macd-v');
    const raw = await redis.get(key);
    if (!raw) continue;

    const indicator = JSON.parse(raw); // CachedIndicatorValue shape
    signals.push(transformIndicatorToSignal(indicator));
  }

  return signals;
}
```

### Anti-Patterns to Avoid

- **Importing @livermore/indicators:** NEVER. The hard IP isolation boundary means public-api cannot depend on the indicators package. Use only data from Redis/DB.
- **Spreading internal objects:** NEVER use `{ ...indicator, }` or `{ ...alertRow, }` followed by delete. Always use explicit field selection (whitelist pattern).
- **Exposing the `details` JSONB column:** The `details` field in alert_history contains indicator-specific data (histogram, signal line values, buffer percentages, chart generation flags). This MUST be completely stripped.
- **Exposing `trigger_value`:** This is the raw MACD-V numeric value. Only expose the mapped `strength` category.
- **Using string 'macdv' in public responses:** The alert_type value is 'macdv' internally. Public API must map this to generic 'momentum_signal'.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Response envelope | Custom wrapper | `createEnvelopeSchema()` from Phase 39 | Already tested, consistent API contract |
| Pagination | Custom cursor logic | `buildPaginationMeta()`, `encodeCursor()`/`decodeCursor()` | Handles edge cases, opaque Base64 cursors |
| OpenAPI spec | Manual JSON | `fastify-type-provider-zod` + `@fastify/swagger` | Zod schemas auto-generate OpenAPI from type definitions |
| Exchange name resolution | Custom lookup | Copy `resolveExchangeId()` pattern from candles.route.ts | In-memory cache, same error handling |
| Error responses | Custom error handling | Plugin's `publicErrorHandler` (already registered) | Sanitized, strips stack traces |

**Key insight:** Phase 39 established all infrastructure patterns. Phase 40 is purely about adding new routes + schemas + transformers that follow identical patterns.

## Common Pitfalls

### Pitfall 1: IP Leakage Through Field Names
**What goes wrong:** Response JSON contains field names like `macdV`, `histogram`, `atr`, `fastEMA` that reveal the proprietary indicator.
**Why it happens:** Developer copies internal field names into public schema.
**How to avoid:** Use ONLY generic names in public schemas: `type`, `direction`, `strength`, `signal_type`. Review every field name in the Zod schema for leakage.
**Warning signs:** Any field name that could be Googled to identify the underlying indicator.

### Pitfall 2: IP Leakage Through Details JSONB
**What goes wrong:** The `details` column in alert_history is passed through to the API response, leaking histogram values, signal line values, buffer percentages, bias calculations.
**Why it happens:** Using `SELECT *` or spreading the database row.
**How to avoid:** Explicit column selection in Drizzle query + explicit whitelist transformer.
**Warning signs:** Any JSONB data appearing in API responses.

### Pitfall 3: Numeric Precision Loss
**What goes wrong:** Prices are returned as JavaScript numbers, losing precision for high-value or high-precision assets.
**Why it happens:** Not converting price to string format.
**How to avoid:** All price fields must use `.toString()` and be typed as `z.string()` in the schema (established pattern from Phase 39 candles).
**Warning signs:** Price fields typed as `z.number()`.

### Pitfall 4: Missing Timeframe in Signal Response
**What goes wrong:** Signal endpoint returns data but consumer cannot correlate signals across timeframes.
**Why it happens:** Forgetting that indicators are per-timeframe and the API needs to either accept timeframe as a param or return multiple timeframes.
**How to avoid:** Design decision: return signals for ALL available timeframes for the symbol. Each signal object includes its timeframe.
**Warning signs:** No timeframe field in signal response schema.

### Pitfall 5: Exchange ID Leakage
**What goes wrong:** Internal numeric exchange IDs (1, 2, 3) appear in API responses instead of string names ("coinbase").
**Why it happens:** Forgetting to resolve exchange_id back to exchange name for alert history.
**How to avoid:** Join with exchanges table or use reverse lookup cache.
**Warning signs:** Numeric IDs in response JSON.

### Pitfall 6: Alert Pagination Using Timestamp Cursor
**What goes wrong:** Duplicate or skipped alerts when multiple alerts share the same millisecond timestamp.
**Why it happens:** Using triggered_at_epoch as cursor value.
**How to avoid:** Use the auto-incrementing `id` column as the cursor value for alert pagination (same pattern as symbols.route.ts). Order by `id DESC` for reverse chronological.
**Warning signs:** Using timestamp-based cursor for database rows.

## Code Examples

### Signal Schema (Explicit Whitelist)
```typescript
// Source: follows pattern from packages/public-api/src/schemas/candle.schema.ts
import { z } from 'zod';

export const PublicSignalSchema = z.object({
  type: z.enum(['momentum_signal', 'trend_signal']).describe('Generic signal type'),
  direction: z.enum(['bullish', 'bearish', 'neutral']).describe('Signal direction'),
  strength: z.enum(['weak', 'moderate', 'strong', 'extreme']).describe('Signal strength'),
  timeframe: z.string().describe('Timeframe this signal applies to (e.g. "15m", "1h")'),
  updated_at: z.string().describe('ISO 8601 timestamp of last signal update'),
});
```

### Alert Schema (Explicit Whitelist)
```typescript
import { z } from 'zod';

export const PublicAlertSchema = z.object({
  timestamp: z.string().describe('ISO 8601 timestamp when alert triggered'),
  symbol: z.string().describe('Trading pair symbol (e.g. "BTC-USD")'),
  exchange: z.string().describe('Exchange identifier (e.g. "coinbase")'),
  timeframe: z.string().describe('Timeframe that triggered the alert (e.g. "15m")'),
  signal_type: z.enum(['momentum_signal']).describe('Generic signal type that triggered'),
  direction: z.enum(['bullish', 'bearish']).describe('Signal direction at time of alert'),
  strength: z.enum(['weak', 'moderate', 'strong', 'extreme']).describe('Signal strength at time of alert'),
  price: z.string().describe('Price at time of alert as string decimal'),
});
```

### Signal Transformer (CRITICAL: Whitelist Only)
```typescript
// Source: follows pattern from packages/public-api/src/transformers/candle.transformer.ts
interface CachedIndicator {
  timestamp: number;
  type: string;
  symbol: string;
  timeframe: string;
  value: Record<string, number>;
  params?: Record<string, unknown>;
}

type SignalDirection = 'bullish' | 'bearish' | 'neutral';
type SignalStrength = 'weak' | 'moderate' | 'strong' | 'extreme';

function deriveDirection(stage: string | undefined): SignalDirection {
  if (!stage) return 'neutral';
  if (['rallying', 'rebounding', 'overbought'].includes(stage)) return 'bullish';
  if (['retracing', 'reversing', 'oversold'].includes(stage)) return 'bearish';
  return 'neutral';
}

function deriveStrength(macdVAbs: number): SignalStrength {
  if (macdVAbs >= 150) return 'extreme';
  if (macdVAbs >= 80) return 'strong';
  if (macdVAbs >= 30) return 'moderate';
  return 'weak';
}

export function transformIndicatorToSignal(indicator: CachedIndicator) {
  const stage = indicator.params?.stage as string | undefined;
  const macdVValue = indicator.value['macdV'] ?? 0;

  return {
    type: 'momentum_signal' as const,
    direction: deriveDirection(stage),
    strength: deriveStrength(Math.abs(macdVValue)),
    timeframe: indicator.timeframe,
    updated_at: new Date(indicator.timestamp).toISOString(),
  };
}
```

### Alert Transformer (CRITICAL: Whitelist Only)
```typescript
function deriveAlertDirection(triggerLabel: string): 'bullish' | 'bearish' {
  // level_-150, level_-200 => bearish (crossing down)
  // level_150, level_200 => bullish (crossing up)
  // reversal_oversold => bullish (reversing from oversold)
  // reversal_overbought => bearish (reversing from overbought)
  if (triggerLabel.startsWith('reversal_oversold')) return 'bullish';
  if (triggerLabel.startsWith('reversal_overbought')) return 'bearish';
  if (triggerLabel.startsWith('level_')) {
    const level = parseInt(triggerLabel.replace('level_', ''), 10);
    return level < 0 ? 'bearish' : 'bullish';
  }
  return 'bearish'; // Safe default
}

function deriveAlertStrength(triggerValue: string | null): SignalStrength {
  if (!triggerValue) return 'moderate';
  const abs = Math.abs(parseFloat(triggerValue));
  if (abs >= 150) return 'extreme';
  if (abs >= 80) return 'strong';
  if (abs >= 30) return 'moderate';
  return 'weak';
}

export function transformAlertHistory(
  row: AlertHistoryRow,
  exchangeName: string
) {
  return {
    timestamp: row.triggeredAt.toISOString(),
    symbol: row.symbol,
    exchange: exchangeName,
    timeframe: row.timeframe ?? '',
    signal_type: 'momentum_signal' as const,
    direction: deriveAlertDirection(row.triggerLabel),
    strength: deriveAlertStrength(row.triggerValue),
    price: row.price.toString(),
  };
}
```

### Alerts Route (Database Query Pattern)
```typescript
// Source: follows pattern from packages/public-api/src/routes/symbols.route.ts
const rows = await db
  .select({
    id: alertHistory.id,
    symbol: alertHistory.symbol,
    timeframe: alertHistory.timeframe,
    triggeredAt: alertHistory.triggeredAt,
    triggerLabel: alertHistory.triggerLabel,
    triggerValue: alertHistory.triggerValue,
    price: alertHistory.price,
    exchangeId: alertHistory.exchangeId,
  })
  .from(alertHistory)
  .where(and(...conditions))
  .orderBy(desc(alertHistory.id))  // Reverse chronological by ID
  .limit(limit + 1);               // +1 for has_more detection
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Expose raw indicator values | Generic labels (direction + strength) | Phase 40 design | IP protection for MACD-V |
| User-scoped indicator keys | Exchange-scoped keys (Tier 1) | Phase 25+ | Public API reads shared data, no userId |

**Deprecated/outdated:**
- Legacy `indicator:{userId}:{exchangeId}:...` keys still exist but should NOT be used by public API. Use `exchangeIndicatorKey()` only.

## Open Questions

1. **Timeframe selection for signals endpoint**
   - What we know: Indicators exist for multiple timeframes (1m, 5m, 15m, 1h, 4h, 1d). Not all may have data for every symbol.
   - What's unclear: Should the endpoint accept an optional `timeframe` query param to filter, or always return all available timeframes?
   - Recommendation: Accept optional `timeframe` query param. Default behavior returns all timeframes with data. This gives clients flexibility.

2. **Trend signal (multi-timeframe composite)**
   - What we know: The requirement mentions `trend_signal` as a signal type. The internal system has a `calculateBias()` function that produces 'Bullish'/'Bearish'/'Neutral' from weighted timeframe stages.
   - What's unclear: Should `trend_signal` be a separate object alongside per-timeframe `momentum_signal` entries?
   - Recommendation: Return one `trend_signal` entry (no timeframe, or timeframe='composite') alongside per-timeframe `momentum_signal` entries. Derive from same weighted bias logic but without importing @livermore/indicators -- replicate the simple bias calculation in the transformer.

3. **Alert filtering query params**
   - What we know: API-03 says `GET /public/v1/alerts` returns alert history. The table supports filtering by exchange, symbol, timeframe, and alert_type.
   - What's unclear: Which filters are required vs optional?
   - Recommendation: All filters optional: `exchange`, `symbol`, `timeframe`, `cursor`, `limit`. No required filters -- allows flexible querying.

4. **Alerts from all exchanges vs specific exchange**
   - What we know: Alert history is exchange-scoped (has exchange_id column).
   - What's unclear: Should `/public/v1/alerts` return alerts across ALL exchanges, or require an exchange param?
   - Recommendation: All exchanges by default, with optional `exchange` filter param. This matches the symbols endpoint pattern.

## Sources

### Primary (HIGH confidence)
- `packages/public-api/src/` -- Full Phase 39 implementation reviewed (plugin.ts, all routes, schemas, transformers, helpers)
- `packages/cache/src/keys.ts` -- Redis key patterns for indicators (`exchangeIndicatorKey()`)
- `packages/cache/src/strategies/indicator-cache.ts` -- CachedIndicatorValue interface shape
- `packages/database/src/schema/alert-history.ts` -- Alert history table schema
- `apps/api/src/services/alert-evaluation.service.ts` -- How alerts are generated and what data is stored
- `apps/api/src/services/indicator-calculation.service.ts` -- What indicator values are stored in Redis (value + params fields)
- `packages/schemas/src/indicators/macdv.schema.ts` -- Internal MACD-V stage/zone/bias definitions
- `packages/database/schema.sql` -- Source of truth for alert_history table DDL

### Secondary (MEDIUM confidence)
- Phase 39 verification report -- Confirms all infrastructure is working and patterns are established

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed; everything from Phase 39
- Architecture: HIGH - Direct extension of Phase 39 patterns with codebase evidence
- Pitfalls: HIGH - IP leakage vectors identified from actual data structures in codebase

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (stable -- internal codebase patterns, no external dependency changes)
