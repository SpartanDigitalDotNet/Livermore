# Stack Research: v4.0 User Settings & Admin Controls

**Project:** Livermore Trading Platform
**Researched:** 2026-01-31
**Scope:** JSONB settings management, Redis pub/sub commands, exchange symbol scanning, form-based settings editor
**Overall Confidence:** HIGH

---

## Executive Summary

This research covers the stack requirements for adding:
1. User settings stored as JSONB in PostgreSQL
2. Redis pub/sub for Admin-to-API command communication
3. Symbol scanner for fetching top exchange symbols
4. Form-based settings editor in React

The existing Livermore stack is well-suited for these features. No new major dependencies are required - the work primarily extends existing patterns with Drizzle ORM (JSONB), ioredis (pub/sub), and adds react-hook-form for the admin UI.

---

## Existing Stack (Keep)

These components are validated and should remain unchanged for v4.0.

| Technology | Version | Purpose | Keep Rationale |
|------------|---------|---------|----------------|
| TypeScript | 5.6.3 | All application code | Established, type safety critical |
| drizzle-orm | 0.36.4 | Database ORM | Already has JSONB with `$type<T>()` |
| ioredis | 5.4.2 | Redis client | Already supports pub/sub |
| postgres | 3.4.5 | PostgreSQL driver | Already configured |
| zod | 3.24.1 | Runtime validation | Used throughout codebase |
| @livermore/coinbase-client | workspace | Coinbase API | Already has `getProducts()` |

---

## Additions Needed

### 1. Admin UI Forms: React Hook Form + Zod

| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| react-hook-form | ^7.54.0 | Form state management | Best DX, minimal re-renders, TypeScript-first |
| @hookform/resolvers | ^3.9.0 | Zod integration | Type-safe validation with existing Zod schemas |

**Installation:**
```bash
pnpm --filter @livermore/admin add react-hook-form @hookform/resolvers
```

**Why React Hook Form:**
- Uncontrolled inputs = minimal re-renders
- `resolver` prop integrates Zod schemas directly
- `formState.errors` provides field-level validation messages
- `formState.isSubmitting` handles loading states
- Already integrates with Zod via `@hookform/resolvers`

**Basic Pattern:**
```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const settingsSchema = z.object({
  watchlist: z.array(z.string()).min(1, "At least one symbol required"),
  alertThreshold: z.number().min(0).max(100),
  refreshInterval: z.number().min(5).max(300),
});

type SettingsForm = z.infer<typeof settingsSchema>;

function SettingsEditor() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      watchlist: [],
      alertThreshold: 5,
      refreshInterval: 30,
    },
  });

  const onSubmit = async (data: SettingsForm) => {
    await trpc.settings.update.mutate(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* Form fields with register() */}
    </form>
  );
}
```

**Alternatives Considered:**

| Library | Verdict | Why Not |
|---------|---------|---------|
| Formik | NO | More boilerplate, larger bundle, less TypeScript support |
| Final Form | NO | Less active development, weaker TypeScript |
| Native useState | NO | Manual validation, more code, easy to get wrong |
| Tanstack Form | MAYBE | Newer library, less ecosystem support currently |

**Confidence:** HIGH - Industry standard, official Zod integration, excellent TypeScript support

**Sources:**
- [React Hook Form useForm Docs](https://react-hook-form.com/docs/useform)
- [@hookform/resolvers GitHub](https://github.com/react-hook-form/resolvers)
- [Zod + React Hook Form Tutorial](https://www.freecodecamp.org/news/react-form-validation-zod-react-hook-form/)

---

### 2. Database: JSONB Settings with Drizzle ORM

**No new dependencies** - Drizzle ORM already supports JSONB with `$type<T>()` for compile-time type safety.

**Current State:**
The existing `user_settings` table uses a global key (no userId):
```typescript
// packages/database/drizzle/schema.ts
export const userSettings = pgTable("user_settings", {
  id: serial().primaryKey().notNull(),
  key: varchar({ length: 100 }).notNull(),
  value: jsonb().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

**Recommended Schema Extension:**
Add `userId` for user-specific settings, or create a new `user_preferences` table:

```typescript
import { jsonb, pgTable, serial, varchar, timestamp, foreignKey } from "drizzle-orm/pg-core";

// Type-safe JSONB with compile-time inference
export const userPreferences = pgTable("user_preferences", {
  id: serial().primaryKey().notNull(),
  userId: serial("user_id").notNull(),
  key: varchar({ length: 100 }).notNull(),
  value: jsonb().$type<UserPreferenceValue>().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdFk: foreignKey({
    columns: [table.userId],
    foreignColumns: [users.id],
    name: "user_preferences_user_id_fk"
  }).onDelete("cascade"),
  uniqueUserKey: unique().on(table.userId, table.key),
}));
```

**Discriminated Union Pattern for Type Safety:**
```typescript
// packages/schemas/src/settings/user-settings.schema.ts
import { z } from "zod";

export const WatchlistSettingsSchema = z.object({
  type: z.literal("watchlist"),
  symbols: z.array(z.string().regex(/^[A-Z]+-[A-Z]+$/)),
  sortBy: z.enum(["alpha", "volume", "change"]).default("alpha"),
});

export const AlertSettingsSchema = z.object({
  type: z.literal("alerts"),
  enabled: z.boolean().default(true),
  priceChangeThreshold: z.number().min(0).max(50).default(5),
  volumeSpike: z.boolean().default(false),
});

export const ScannerSettingsSchema = z.object({
  type: z.literal("scanner"),
  topN: z.number().min(10).max(100).default(50),
  quoteAsset: z.enum(["USD", "USDC"]).default("USD"),
  minVolume24h: z.number().min(0).default(100000),
});

// Discriminated union for type-safe storage
export const UserPreferenceValueSchema = z.discriminatedUnion("type", [
  WatchlistSettingsSchema,
  AlertSettingsSchema,
  ScannerSettingsSchema,
]);

export type UserPreferenceValue = z.infer<typeof UserPreferenceValueSchema>;
```

**JSONB Query Pattern:**
Drizzle requires raw SQL for JSONB field access (native operators not yet supported):
```typescript
import { sql } from "drizzle-orm";

// Query JSONB field
const results = await db.select()
  .from(userPreferences)
  .where(sql`${userPreferences.value}->>'type' = 'watchlist'`);
```

**Confidence:** HIGH - Official Drizzle docs verify `$type<T>()` pattern, existing codebase already uses JSONB

**Sources:**
- [Drizzle ORM PostgreSQL Column Types](https://orm.drizzle.team/docs/column-types/pg)
- [Drizzle JSONB Type Safety Discussion](https://github.com/drizzle-team/drizzle-orm/discussions/386)
- [Drizzle PostgreSQL Best Practices 2025](https://gist.github.com/productdevbook/7c9ce3bbeb96b3fabc3c7c2aa2abc717)

---

### 3. Redis Pub/Sub: Admin Commands

**No new dependencies** - ioredis already supports pub/sub. The existing `createRedisPubSubClient()` in `@livermore/cache` provides the pattern.

**Critical Rule:** Separate clients for pub/sub vs regular operations.

Once a Redis client calls `subscribe()`, it enters "subscriber mode" and can ONLY execute:
- `subscribe`, `psubscribe`
- `unsubscribe`, `punsubscribe`
- `ping`, `quit`

Regular commands (`set`, `get`, `zadd`, etc.) will fail.

**Implementation Pattern:**

```typescript
// packages/cache/src/pubsub/admin-commands.ts
import Redis from "ioredis";
import { createLogger } from "@livermore/utils";

const logger = createLogger("admin-pubsub");

// Channel constants
export const ADMIN_COMMANDS_CHANNEL = "admin:commands";
export const ADMIN_STATUS_CHANNEL = "admin:status";

// Command types (defined in @livermore/schemas)
export interface AdminCommand {
  type: "SCANNER_START" | "SCANNER_STOP" | "REFRESH_SYMBOLS" | "SYNC_SETTINGS";
  payload: Record<string, unknown>;
  timestamp: number;
}

// Publisher (used by API server to publish commands from Admin UI)
export class AdminCommandPublisher {
  constructor(private redis: Redis) {}

  async publish(command: AdminCommand): Promise<void> {
    const message = JSON.stringify({
      ...command,
      timestamp: Date.now(),
    });
    await this.redis.publish(ADMIN_COMMANDS_CHANNEL, message);
    logger.info({ type: command.type }, "Published admin command");
  }

  async publishStatus(status: { type: string; data: unknown }): Promise<void> {
    await this.redis.publish(ADMIN_STATUS_CHANNEL, JSON.stringify(status));
  }
}

// Subscriber (used by API server to handle incoming commands)
export class AdminCommandSubscriber {
  private subscriber: Redis;

  constructor(private redis: Redis) {
    // MUST create separate client for subscribing
    this.subscriber = redis.duplicate();
  }

  async start(handler: (command: AdminCommand) => Promise<void>): Promise<void> {
    await this.subscriber.subscribe(ADMIN_COMMANDS_CHANNEL);

    this.subscriber.on("message", async (channel, message) => {
      if (channel === ADMIN_COMMANDS_CHANNEL) {
        try {
          const command = JSON.parse(message) as AdminCommand;
          await handler(command);
        } catch (err) {
          logger.error({ err, message }, "Failed to handle admin command");
        }
      }
    });

    // Re-subscribe on reconnection
    this.subscriber.on("ready", () => {
      this.subscriber.subscribe(ADMIN_COMMANDS_CHANNEL);
    });

    logger.info("Admin command subscriber started");
  }

  async stop(): Promise<void> {
    await this.subscriber.unsubscribe(ADMIN_COMMANDS_CHANNEL);
    await this.subscriber.quit();
  }
}
```

**Channel Naming Convention:**
```
admin:commands           # Admin UI -> API server commands
admin:status             # API server -> Admin UI status updates
scanner:results:{userId} # Scanner results per user
settings:changed:{userId} # Settings change notifications
```

**Existing Pattern Reference:**
The codebase already uses Redis pub/sub for candle close events in `CoinbaseAdapter`:
```typescript
// packages/coinbase-client/src/adapter/coinbase-adapter.ts line 514-524
const channel = candleCloseChannel(
  this.userId,
  this.exchangeIdNum,
  candle.symbol,
  candle.timeframe
);
await this.redis.publish(channel, JSON.stringify(candle));
```

**Confidence:** HIGH - ioredis pub/sub is well-documented, existing codebase already uses pattern

**Sources:**
- [ioredis GitHub - Pub/Sub](https://github.com/redis/ioredis)
- [Redis Pub/Sub Official Docs](https://redis.io/docs/latest/develop/pubsub/)
- [ioredis Pub/Sub Guide](https://thisdavej.com/guides/redis-node/node/pubsub.html)

---

### 4. Symbol Scanner: Coinbase Products API

**No new dependencies** - The existing `CoinbaseRestClient.getProducts()` already fetches all products.

**Current Implementation:**
```typescript
// packages/coinbase-client/src/rest/client.ts
async getProducts(): Promise<any[]> {
  const path = '/api/v3/brokerage/products';
  const response = await this.request('GET', path);
  return response.products || [];
}
```

**Recommended Extension:**
Add a method to get top symbols by volume:

```typescript
// Add to CoinbaseRestClient class
interface CoinbaseProduct {
  product_id: string;        // "BTC-USD"
  base_currency_id: string;  // "BTC"
  quote_currency_id: string; // "USD"
  status: "online" | "offline" | "delisted";
  volume_24h: string;        // 24h trading volume
  price: string;             // Current price
  price_percentage_change_24h: string;
}

async getTopSymbolsByVolume(
  limit: number = 50,
  quoteAsset: string = "USD"
): Promise<CoinbaseProduct[]> {
  const products = await this.getProducts();

  return products
    .filter((p: CoinbaseProduct) =>
      p.status === "online" &&
      p.quote_currency_id === quoteAsset &&
      parseFloat(p.volume_24h) > 0
    )
    .sort((a: CoinbaseProduct, b: CoinbaseProduct) =>
      parseFloat(b.volume_24h) - parseFloat(a.volume_24h)
    )
    .slice(0, limit);
}
```

**Scanner Service Pattern:**
```typescript
// packages/services/src/scanner/symbol-scanner.ts
export class SymbolScanner {
  constructor(
    private restClient: CoinbaseRestClient,
    private redis: Redis
  ) {}

  async scan(options: ScannerOptions): Promise<ScanResult[]> {
    const products = await this.restClient.getTopSymbolsByVolume(
      options.topN,
      options.quoteAsset
    );

    const results: ScanResult[] = products
      .filter(p => parseFloat(p.volume_24h) >= options.minVolume24h)
      .map(p => ({
        symbol: p.product_id,
        volume24h: parseFloat(p.volume_24h),
        price: parseFloat(p.price),
        change24h: parseFloat(p.price_percentage_change_24h),
      }));

    // Cache results
    await this.redis.setex(
      `scanner:results:${options.userId}`,
      300, // 5 minute TTL
      JSON.stringify(results)
    );

    return results;
  }
}
```

**Why NOT CCXT:**
- Livermore is Coinbase-only (for now)
- CCXT adds 2MB+ bundle size
- Extra abstraction layer = more complexity
- Already have working Coinbase client with JWT auth
- Would need to learn CCXT API on top of Coinbase API

**If Multi-Exchange Later:**
Revisit CCXT or build on existing `BaseExchangeAdapter` pattern.

**Confidence:** HIGH - Existing working implementation, just needs extension

**Sources:**
- [Coinbase Advanced Trade API](https://docs.cdp.coinbase.com/advanced-trade/docs/api-overview/)
- [CCXT npm](https://www.npmjs.com/package/ccxt) - evaluated but not recommended

---

## Full Installation Commands

```bash
# Admin UI forms (new dependencies)
pnpm --filter @livermore/admin add react-hook-form @hookform/resolvers

# No new backend dependencies required - all existing:
# - drizzle-orm (JSONB) - already ^0.36.4
# - ioredis (pub/sub) - already ^5.4.2
# - @livermore/coinbase-client (products API) - workspace package
# - zod (schemas) - already ^3.24.1
```

---

## Patterns to Follow

### 1. Settings Schema Organization

Create Zod schemas in `@livermore/schemas` for settings types:

```typescript
// packages/schemas/src/settings/index.ts
export * from "./watchlist.schema";
export * from "./alerts.schema";
export * from "./scanner.schema";
export * from "./user-preference.schema";
```

### 2. tRPC Router for Settings

```typescript
// apps/api/src/routers/settings.router.ts
import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { UserPreferenceValueSchema } from "@livermore/schemas";

export const settingsRouter = router({
  get: protectedProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.userPreferences.findFirst({
        where: and(
          eq(userPreferences.userId, ctx.user.id),
          eq(userPreferences.key, input.key)
        )
      });
    }),

  update: protectedProcedure
    .input(z.object({
      key: z.string(),
      value: UserPreferenceValueSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      // Upsert to database
      await ctx.db.insert(userPreferences)
        .values({
          userId: ctx.user.id,
          key: input.key,
          value: input.value,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [userPreferences.userId, userPreferences.key],
          set: {
            value: input.value,
            updatedAt: new Date(),
          }
        });

      // Publish change notification via Redis pub/sub
      await ctx.publisher.publish({
        type: "SYNC_SETTINGS",
        payload: { userId: ctx.user.id, key: input.key }
      });
    }),
});
```

### 3. Admin Command Types

```typescript
// packages/schemas/src/admin/commands.schema.ts
import { z } from "zod";

export const AdminCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SCANNER_START"),
    payload: z.object({
      userId: z.number(),
      filters: z.object({
        topN: z.number(),
        quoteAsset: z.string(),
        minVolume24h: z.number().optional(),
      }),
    }),
  }),
  z.object({
    type: z.literal("SCANNER_STOP"),
    payload: z.object({ userId: z.number() }),
  }),
  z.object({
    type: z.literal("REFRESH_SYMBOLS"),
    payload: z.object({}),
  }),
  z.object({
    type: z.literal("SYNC_SETTINGS"),
    payload: z.object({ userId: z.number(), key: z.string().optional() }),
  }),
]);

export type AdminCommand = z.infer<typeof AdminCommandSchema>;
```

---

## Anti-Patterns to Avoid

### 1. Single Redis Client for Everything

**BAD:**
```typescript
const redis = createRedisClient(config);
redis.subscribe("channel"); // Now redis can ONLY do subscribe commands!
redis.set("key", "value");  // ERROR: client is in subscriber mode
```

**GOOD:**
```typescript
const publisher = createRedisClient(config);
const subscriber = createRedisClient(config); // or publisher.duplicate()
subscriber.subscribe("channel");
publisher.set("key", "value"); // Works fine
```

### 2. Storing Complex Objects Without Schema

**BAD:**
```typescript
// Untyped JSONB - runtime errors waiting to happen
value: jsonb().default({})
```

**GOOD:**
```typescript
// Type-safe with validation
value: jsonb().$type<z.infer<typeof SettingsSchema>>()
// PLUS validate on insert/update with Zod
```

### 3. Polling Instead of Pub/Sub

**BAD:**
```typescript
// Admin UI polling for status every 5 seconds
setInterval(() => fetchStatus(), 5000);
```

**GOOD:**
```typescript
// Real-time via WebSocket subscription backed by Redis pub/sub
const statusSubscription = trpc.admin.status.subscribe({
  onData: (status) => setStatus(status)
});
```

### 4. JSONB for High-Query Fields

**BAD:**
```typescript
// Frequently queried field buried in JSONB
where(sql`${settings.value}->>'status' = 'active'`)
```

**GOOD:**
```typescript
// Frequently queried = top-level column with index
isActive: boolean("is_active").default(true).notNull()
```

---

## Version Compatibility Matrix

| Package | Current | Recommended | Notes |
|---------|---------|-------------|-------|
| drizzle-orm | 0.36.4 | 0.36.4 | Keep current, JSONB $type works |
| ioredis | 5.4.2 | 5.4.2 | Keep current, pub/sub works |
| zod | 3.24.1 | 3.24.1 | Keep current |
| react-hook-form | NEW | ^7.54.0 | Add to admin package |
| @hookform/resolvers | NEW | ^3.9.0 | Add to admin package |

---

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| React Hook Form | HIGH | Official docs, standard industry choice, Zod integration |
| Drizzle JSONB | HIGH | Official docs, existing pattern in codebase |
| ioredis Pub/Sub | HIGH | Official docs, existing usage in codebase |
| Coinbase Products API | HIGH | Existing working implementation |
| Admin Command Pattern | MEDIUM | Designed pattern, needs implementation validation |
| Settings Schema Design | HIGH | Follows existing codebase patterns |

---

## Sources

### Official Documentation (HIGH confidence)
- [Drizzle ORM PostgreSQL Column Types](https://orm.drizzle.team/docs/column-types/pg)
- [ioredis GitHub](https://github.com/redis/ioredis)
- [Redis Pub/Sub Docs](https://redis.io/docs/latest/develop/pubsub/)
- [React Hook Form useForm](https://react-hook-form.com/docs/useform)
- [@hookform/resolvers](https://github.com/react-hook-form/resolvers)
- [Coinbase Advanced Trade API](https://docs.cdp.coinbase.com/advanced-trade/docs/api-overview/)

### Community Resources (MEDIUM confidence)
- [Drizzle JSONB Best Practices 2025](https://gist.github.com/productdevbook/7c9ce3bbeb96b3fabc3c7c2aa2abc717)
- [ioredis Pub/Sub Guide](https://thisdavej.com/guides/redis-node/node/pubsub.html)
- [React Hook Form + Zod Tutorial](https://www.freecodecamp.org/news/react-form-validation-zod-react-hook-form/)
- [Drizzle JSONB Type Safety Discussion](https://github.com/drizzle-team/drizzle-orm/discussions/386)

### Evaluated but Not Recommended
- [CCXT npm](https://www.npmjs.com/package/ccxt) - Overkill for single-exchange use

---

*Stack research complete. Ready for roadmap phase structure.*
