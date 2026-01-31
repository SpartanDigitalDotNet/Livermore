---
phase: 20-symbol-management
plan: 01
subsystem: api-routers
tags: [trpc, coinbase, symbol-validation, admin-api]

dependency-graph:
  requires:
    - "18-control-channel (ControlChannelService infrastructure)"
    - "17-settings-infrastructure (UserSettingsSchema with symbols field)"
  provides:
    - "symbol.router.ts with search/validate/metrics endpoints"
    - "Admin UI can now search and validate symbols against Coinbase"
  affects:
    - "20-02 (add-symbol/remove-symbol command handlers)"
    - "22-admin-ui (Symbol Management UI will consume these endpoints)"

tech-stack:
  added: []
  patterns:
    - "tRPC protectedProcedure for all symbol endpoints"
    - "CoinbaseRestClient for exchange API calls"
    - "Symbol normalization (SOLUSD -> SOL-USD)"
    - "Rate limiting with 100ms delay between batch calls"

file-tracking:
  created:
    - "apps/api/src/routers/symbol.router.ts"
  modified:
    - "apps/api/src/routers/index.ts"

decisions:
  - decision: "Single exchange (Coinbase) for now"
    rationale: "User's primary exchange is Coinbase; Binance support deferred"
  - decision: "Rate limit metrics endpoint with 100ms delay"
    rationale: "Coinbase has 10 req/sec limit; 100ms delay keeps us safe"
  - decision: "Symbol normalization handles common formats"
    rationale: "Users may type SOLUSD instead of SOL-USD; normalize before validation"

metrics:
  duration: "~5 minutes"
  completed: "2026-01-31"
---

# Phase 20 Plan 01: Symbol Router API Summary

**One-liner:** tRPC symbol router with search, validate, and metrics endpoints for Admin UI symbol management

## What Was Built

Created `symbol.router.ts` with three tRPC endpoints that enable the Admin UI to interact with Coinbase exchange for symbol validation:

### 1. search endpoint (SYM-04)
- Input: `{ query: string, limit?: number }`
- Queries all Coinbase products via `getProducts()`
- Filters by product_id or base_display_symbol (case-insensitive)
- Returns only online, tradeable products
- Output: `{ results: [{ symbol, baseName, quoteName }], exchange: 'coinbase' }`

### 2. validate endpoint (SYM-03, SYM-06)
- Input: `{ symbol: string }`
- Normalizes symbol format (e.g., "SOLUSD" -> "SOL-USD")
- Validates symbol exists on Coinbase via `getProduct()`
- Returns metrics preview for valid symbols
- Output: `{ valid: boolean, symbol, metrics?: { price, priceChange24h, volume24h, baseName, quoteName }, error?: string }`

### 3. metrics endpoint (SYM-06)
- Input: `{ symbols: string[] }` (max 20)
- Batch fetches metrics for multiple symbols
- Respects rate limits with 100ms delay between calls
- Output: Array of `{ symbol, price, priceChange24h, volume24h }` or `{ symbol, error }`

## Key Implementation Details

**Symbol Normalization:**
```typescript
function normalizeSymbol(input: string): string {
  const clean = input.trim().toUpperCase();
  if (clean.includes('-')) return clean;

  // Try to split at common quote currencies
  const quotes = ['USD', 'USDC', 'USDT', 'EUR', 'GBP'];
  for (const quote of quotes) {
    if (clean.endsWith(quote)) {
      return `${clean.slice(0, -quote.length)}-${quote}`;
    }
  }
  return clean;
}
```

**Authentication:** All endpoints use `protectedProcedure`, requiring Clerk authentication.

**Coinbase Client:** Instantiated from environment variables `COINBASE_API_KEY_ID` and `COINBASE_PRIVATE_KEY`.

## Commits

| Hash | Description |
|------|-------------|
| 0c95815 | feat(20-01): add symbol.router.ts with search, validate, metrics endpoints |
| 3602a07 | feat(20-01): register symbolRouter in appRouter |

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/routers/symbol.router.ts` | Created (218 lines) |
| `apps/api/src/routers/index.ts` | Modified (import, register, export) |

## Deviations from Plan

None - plan executed exactly as written.

## Requirements Coverage

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| SYM-03 | Partial | validate endpoint validates against exchange |
| SYM-04 | Complete | search endpoint queries available symbols |
| SYM-06 | Complete | validate and metrics endpoints return metrics preview |

**Note:** SYM-01, SYM-02, SYM-05 (command handlers) are addressed in plan 20-02.

## Next Phase Readiness

**Ready for 20-02:** Symbol router provides validation endpoints that command handlers can reference.

**Blockers:** None

**Admin UI Integration:** Phase 22 will create the UI that consumes these endpoints.
