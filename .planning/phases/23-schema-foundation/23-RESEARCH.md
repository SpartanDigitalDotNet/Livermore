# Phase 23: Schema Foundation - Research

**Researched:** 2026-02-06
**Domain:** PostgreSQL schema extension for multi-exchange metadata normalization
**Confidence:** HIGH

## Summary

This phase establishes the database foundation for a multi-exchange architecture by creating an `exchanges` metadata table and refactoring `user_exchanges` to reference it via foreign key. The current schema stores exchange identity as a string column (`exchange_name`) in `user_exchanges`, leading to denormalized data and no central repository for exchange-specific metadata like API limits, WebSocket URLs, or supported timeframes.

The approach creates a new `exchanges` table with comprehensive metadata fields, seeds it with Coinbase and Binance data, and adds a nullable `exchange_id` FK column to `user_exchanges`. The FK is nullable during migration to preserve backward compatibility with existing rows that still use the `exchange_name` string.

**Primary recommendation:** Create `exchanges` table with JSONB for flexible fields (supported_timeframes, api_limits, geo_restrictions), seed Coinbase and Binance data, add nullable FK to `user_exchanges`, and run `drizzle-kit pull` to regenerate TypeScript types.

## Standard Stack

This phase uses the established database-first workflow from Phase 11.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Atlas | 0.30+ | Schema deployment | State-based migrations, already configured in atlas.hcl |
| Drizzle Kit | 0.22+ | Type generation | Pull-based workflow established |
| PostgreSQL | 15+ | Database | Already deployed locally and Azure sandbox |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `sync-schema.ps1` | Local deployment + type regen | After editing schema.sql |
| `apply-schema-sandbox.ps1` | Azure sandbox deployment | After local verification |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSONB for timeframes | VARCHAR array | JSONB more flexible for nested metadata |
| Single metadata table | Separate tables per field | Over-normalized, more JOINs needed |
| Hard-delete exchange_name | Keep both columns | Migration safety vs. cleanup debt |

## Architecture Patterns

### Current Schema Structure

Current `user_exchanges` table (from `schema.sql`):
```sql
CREATE TABLE "user_exchanges" (
  "id" serial NOT NULL,
  "user_id" serial NOT NULL,
  "exchange_name" character varying(50) NOT NULL,  -- String, denormalized
  "display_name" character varying(100) NULL,
  "api_key" character varying(500) NOT NULL,
  "api_secret" text NOT NULL,
  "additional_credentials" text NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "is_default" boolean NOT NULL DEFAULT false,
  "last_connected_at" timestamp NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "user_exchanges_user_id_users_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
```

**Problem:** Exchange metadata (WebSocket URL, supported timeframes, fees) is not stored anywhere. Each adapter hardcodes these values.

### Proposed `exchanges` Table

```sql
CREATE TABLE "exchanges" (
  "id" serial NOT NULL,
  "name" character varying(50) NOT NULL,           -- Technical identifier: 'coinbase', 'binance'
  "display_name" character varying(100) NOT NULL,  -- Human-readable: 'Coinbase Advanced Trade'
  "ws_url" character varying(255) NULL,            -- WebSocket endpoint
  "rest_url" character varying(255) NULL,          -- REST API base URL
  "supported_timeframes" jsonb NOT NULL DEFAULT '[]'::jsonb,  -- Array of supported granularities
  "api_limits" jsonb NULL,                         -- Rate limits, weights, etc.
  "fee_schedule" jsonb NULL,                       -- Maker/taker fee tiers
  "geo_restrictions" jsonb NULL,                   -- Blocked countries/regions
  "is_active" boolean NOT NULL DEFAULT true,       -- Enable/disable exchange
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "exchanges_name_unique" UNIQUE ("name")
);
```

### Proposed `user_exchanges` FK Addition

```sql
-- Add nullable FK during migration (existing rows have NULL)
ALTER TABLE "user_exchanges" ADD COLUMN "exchange_id" integer NULL;
ALTER TABLE "user_exchanges" ADD CONSTRAINT "user_exchanges_exchange_id_exchanges_id_fk"
  FOREIGN KEY ("exchange_id") REFERENCES "exchanges" ("id")
  ON UPDATE NO ACTION ON DELETE SET NULL;

-- Index for efficient lookups
CREATE INDEX "user_exchanges_exchange_id_idx" ON "user_exchanges" ("exchange_id");
```

**Migration Strategy:**
1. Add `exchange_id` as nullable column
2. After migration, update existing rows: `UPDATE user_exchanges SET exchange_id = (SELECT id FROM exchanges WHERE name = user_exchanges.exchange_name)`
3. Future: Make `exchange_id` NOT NULL, drop `exchange_name` column

### Anti-Patterns to Avoid

- **Making exchange_id NOT NULL immediately:** Breaks existing rows that don't have exchange_id set
- **Deleting exchange_name column:** Breaks application code still referencing it
- **Using ENUM for exchange names:** Cannot add new exchanges without migration
- **Storing timeframes as comma-separated string:** Loses queryability, use JSONB array

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timeframe validation | String parsing in application | JSONB array + schema validation | Database ensures consistency |
| Exchange lookup by name | Repeated SELECT queries | Cached in memory at startup | `exchanges` table rarely changes |
| Fee calculation | Hardcoded percentages | JSONB fee_schedule column | Centralizes exchange-specific data |

## Common Pitfalls

### Pitfall 1: Circular Dependency with Seed Data

**What goes wrong:** Schema references tables that don't exist yet, or INSERT fails due to FK constraints.
**Why it happens:** Atlas applies schema atomically, but seed data may run before tables exist.
**How to avoid:** Include seed data as INSERT statements in schema.sql after CREATE TABLE statements.
**Warning signs:** "relation does not exist" errors during `atlas schema apply`.

### Pitfall 2: JSONB vs TEXT for Structured Data

**What goes wrong:** Using TEXT for JSON-like data loses Postgres JSON operators.
**Why it happens:** Familiarity with simpler column types.
**How to avoid:** Use JSONB for structured metadata (timeframes, api_limits, fee_schedule).
**Warning signs:** Application parses JSON from TEXT column, no index on JSON paths.

### Pitfall 3: Forgetting to Update Indexes After FK Addition

**What goes wrong:** Queries filtering by exchange_id do full table scans.
**Why it happens:** FK constraint doesn't automatically create index.
**How to avoid:** Explicitly create `user_exchanges_exchange_id_idx` index.
**Warning signs:** Slow queries joining user_exchanges to exchanges.

### Pitfall 4: Breaking Drizzle Types with JSONB

**What goes wrong:** Drizzle pull generates `unknown` type for JSONB columns.
**Why it happens:** JSONB is untyped at database level.
**How to avoid:** After pull, add TypeScript interfaces and type assertions in application code.
**Warning signs:** `any` types proliferating through codebase from JSONB columns.

## Code Examples

### Final schema.sql - exchanges Table

```sql
-- Create "exchanges" table (Phase 23)
-- Exchange metadata for multi-exchange architecture
CREATE TABLE "exchanges" (
  "id" serial NOT NULL,
  "name" character varying(50) NOT NULL,
  "display_name" character varying(100) NOT NULL,
  "ws_url" character varying(255) NULL,
  "rest_url" character varying(255) NULL,
  "supported_timeframes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "api_limits" jsonb NULL,
  "fee_schedule" jsonb NULL,
  "geo_restrictions" jsonb NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "exchanges_name_unique" UNIQUE ("name")
);

-- Seed data for Coinbase and Binance
INSERT INTO "exchanges" ("name", "display_name", "ws_url", "rest_url", "supported_timeframes", "api_limits", "fee_schedule") VALUES
  ('coinbase', 'Coinbase Advanced Trade',
   'wss://advanced-trade-ws.coinbase.com',
   'https://api.coinbase.com',
   '["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "1d"]'::jsonb,
   '{"ws_connections_per_ip": 750, "ws_messages_per_second": 8, "rest_weight_limit": 10000}'::jsonb,
   '{"base_maker": 0.006, "base_taker": 0.012}'::jsonb
  ),
  ('binance', 'Binance Spot',
   'wss://stream.binance.com:9443',
   'https://api.binance.com',
   '["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]'::jsonb,
   '{"ws_connections_per_5min": 300, "rest_weight_limit": 6000, "orders_per_10s": 50}'::jsonb,
   '{"base_maker": 0.001, "base_taker": 0.001}'::jsonb
  );
```

### Final schema.sql - user_exchanges FK Addition

For Atlas state-based migrations, integrate the new column directly into the CREATE TABLE statement:

```sql
-- Create "user_exchanges" table (updated for Phase 23)
CREATE TABLE "user_exchanges" (
  "id" serial NOT NULL,
  "user_id" serial NOT NULL,
  "exchange_name" character varying(50) NOT NULL,
  "exchange_id" integer NULL,  -- NEW: FK to exchanges table (nullable during migration)
  "display_name" character varying(100) NULL,
  "api_key" character varying(500) NOT NULL,
  "api_secret" text NOT NULL,
  "additional_credentials" text NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "is_default" boolean NOT NULL DEFAULT false,
  "last_connected_at" timestamp NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "user_exchanges_user_id_users_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "user_exchanges_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id")
    REFERENCES "exchanges" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

-- Create index for exchange_id lookups
CREATE INDEX "user_exchanges_exchange_id_idx" ON "user_exchanges" ("exchange_id");
```

### Expected Drizzle Types (after pull)

```typescript
// packages/database/drizzle/schema.ts (generated by drizzle-kit pull)
export const exchanges = pgTable("exchanges", {
  id: serial().primaryKey().notNull(),
  name: varchar({ length: 50 }).notNull(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  wsUrl: varchar("ws_url", { length: 255 }),
  restUrl: varchar("rest_url", { length: 255 }),
  supportedTimeframes: jsonb("supported_timeframes").default([]).notNull(),
  apiLimits: jsonb("api_limits"),
  feeSchedule: jsonb("fee_schedule"),
  geoRestrictions: jsonb("geo_restrictions"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
  return {
    exchangesNameUnique: unique("exchanges_name_unique").on(table.name),
  }
});

export const userExchanges = pgTable("user_exchanges", {
  // ... existing columns ...
  exchangeId: integer("exchange_id"),  // NEW: nullable FK
  // ... rest of columns ...
}, (table) => {
  return {
    // ... existing constraints ...
    exchangeIdIdx: index("user_exchanges_exchange_id_idx").using("btree", table.exchangeId),
    userExchangesExchangeIdExchangesIdFk: foreignKey({
      columns: [table.exchangeId],
      foreignColumns: [exchanges.id],
      name: "user_exchanges_exchange_id_exchanges_id_fk"
    }).onDelete("set null"),
  }
});
```

### TypeScript Types for JSONB Columns

```typescript
// packages/database/src/types/exchange.ts
export interface ExchangeApiLimits {
  ws_connections_per_ip?: number;
  ws_connections_per_5min?: number;
  ws_messages_per_second?: number;
  rest_weight_limit?: number;
  orders_per_10s?: number;
  orders_per_day?: number;
}

export interface ExchangeFeeSchedule {
  base_maker: number;
  base_taker: number;
  // Volume tiers can be added later
}

export interface ExchangeGeoRestrictions {
  blocked_countries?: string[];
  us_only?: boolean;
}

export type SupportedTimeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';
```

## Exchange Metadata Reference

### Coinbase Advanced Trade

| Field | Value | Source |
|-------|-------|--------|
| WebSocket URL | `wss://advanced-trade-ws.coinbase.com` | Verified in codebase |
| REST URL | `https://api.coinbase.com` | Official docs |
| Supported Timeframes | 1m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 1d | Official API docs |
| WS Rate Limit | 750 connections/s per IP, 8 msgs/s unauth | Official docs |
| Base Fees | 0.60% maker, 1.20% taker (Intro tier) | Official fee page |

**Note:** Coinbase has 2h and 6h timeframes but no 3m, 8h, 12h, 3d, 1w, or 1M.

### Binance Spot

| Field | Value | Source |
|-------|-------|--------|
| WebSocket URL | `wss://stream.binance.com:9443` | Official docs |
| REST URL | `https://api.binance.com` | Official docs |
| Supported Timeframes | 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M | Official API docs |
| WS Rate Limit | 300 connections per 5 min per IP | Official docs |
| REST Weight Limit | 6000 weight per minute | Official docs |
| Base Fees | 0.10% maker, 0.10% taker | Official fee page |

**Note:** Binance has 3m, 8h, 12h, 3d, 1w, and 1M timeframes that Coinbase lacks.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded exchange constants | Database-driven exchange metadata | This phase | Enables runtime exchange configuration |
| String exchange identifiers | Integer FK to normalized table | This phase | Referential integrity, JOIN efficiency |
| Per-adapter WebSocket URLs | Centralized ws_url column | This phase | Single source of truth for connection endpoints |

## Open Questions

1. **Should fee_schedule include volume tier breakpoints?**
   - What we know: Base fees stored, tiers vary by user volume
   - What's unclear: Should we store full tier structure or just base?
   - Recommendation: Start with base fees only; add tiers if pricing features needed

2. **When to make exchange_id NOT NULL?**
   - What we know: Nullable during migration for backward compatibility
   - What's unclear: Timeline for backfill and enforcement
   - Recommendation: Phase 28 (Adapter Refactor) should make it NOT NULL after migration script runs

3. **Should geo_restrictions block API calls at application level?**
   - What we know: Field stores restriction data
   - What's unclear: Enforcement mechanism
   - Recommendation: Store data now, enforce in future phase if needed

## Sources

### Primary (HIGH confidence)
- `packages/database/schema.sql` - Current user_exchanges structure verified
- `packages/coinbase-client/src/adapter/coinbase-adapter.ts` - WebSocket URL verified
- [Coinbase Advanced Trade API - Get Product Candles](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product-candles) - Timeframes verified
- [Binance Spot API - Market Data Endpoints](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints) - Timeframes verified

### Secondary (MEDIUM confidence)
- [Coinbase Advanced Trade WebSocket Overview](https://docs.cdp.coinbase.com/advanced-trade/docs/ws-overview) - WebSocket URL and rate limits
- [Binance WebSocket Streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams) - WebSocket URL confirmed
- [Binance Rate Limits](https://developers.binance.com/docs/binance-spot-api-docs/websocket-api/rate-limits) - Connection limits
- [Coinbase Advanced Fees](https://help.coinbase.com/en/coinbase/trading-and-funding/advanced-trade/advanced-trade-fees) - Fee structure
- [Binance Spot Trading Fee Rate](https://www.binance.com/en/fee/spotMaker) - Base fee rates

### Tertiary (LOW confidence)
- [Atlas PostgreSQL Declarative Migrations](https://atlasgo.io/getting-started/postgresql-declarative-sql) - General workflow patterns

## Metadata

**Confidence breakdown:**
- Schema design: HIGH - Based on existing patterns in schema.sql and Drizzle types
- Exchange metadata: HIGH - Verified against official API documentation
- Atlas workflow: HIGH - Established workflow from Phase 11
- Seed data accuracy: MEDIUM - Fee schedules change; verify at implementation time

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (exchange API limits/fees may update quarterly)
