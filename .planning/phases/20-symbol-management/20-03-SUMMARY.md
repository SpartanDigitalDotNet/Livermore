---
phase: 20
plan: 03
subsystem: symbol-management
tags: [bulk-import, validation, tRPC, control-channel]

dependency-graph:
  requires: ["20-01", "20-02"]
  provides: ["bulk-validate-endpoint", "bulk-add-symbols-command"]
  affects: ["21-admin-ui", "22-admin-ui"]

tech-stack:
  added: []
  patterns: ["delta-based-validation", "bulk-atomic-operations"]

key-files:
  created: []
  modified:
    - apps/api/src/routers/symbol.router.ts
    - apps/api/src/services/control-channel.service.ts
    - packages/schemas/src/control/command.schema.ts

decisions:
  - id: "bulk-validation-max-50"
    choice: "Limit bulk validation to 50 symbols"
    rationale: "50 symbols * 100ms delay = 5s max request time, reasonable UX"

metrics:
  duration: "5 minutes"
  completed: "2026-01-31"
---

# Phase 20 Plan 03: Bulk Symbol Import Summary

Bulk validation endpoint and bulk-add-symbols command for Admin UI import flow.

## What Was Built

### bulkValidate Endpoint (SYM-05, SYM-03)

```typescript
// POST /symbol.bulkValidate
{
  symbols: string[]  // Up to 50 symbols
}

// Response
{
  results: Array<{
    symbol: string;
    status: 'valid' | 'invalid' | 'duplicate';
    metrics?: { price, volume24h, priceChange24h, baseName, quoteName };
    error?: string;
  }>;
  summary: {
    valid: number;
    invalid: number;
    duplicate: number;
    total: number;
  };
}
```

Key behaviors:
- Delta-based validation: checks symbols against user's existing watchlist
- Duplicates detected locally (no API call needed)
- Valid symbols include metrics preview (price, 24h volume, 24h change)
- Rate limited 100ms between exchange API calls

### bulk-add-symbols Command Handler (SYM-05)

```typescript
// Command payload
{
  type: 'bulk-add-symbols',
  payload: {
    symbols: ['ETH-USD', 'SOL-USD', 'LINK-USD']
  }
}

// Response
{
  added: 3,
  skipped: 0,
  symbols: [
    { symbol: 'ETH-USD', backfilled: true },
    { symbol: 'SOL-USD', backfilled: true },
    { symbol: 'LINK-USD', backfilled: true }
  ],
  totalSymbols: 6,
  timestamp: 1738367000000
}
```

Key behaviors:
- Filters duplicates before adding (idempotent)
- Atomic database update with jsonb_set
- Backfills all new symbols when not paused
- Updates indicator configs for all timeframes
- Resubscribes WebSocket with updated symbol list

## Files Modified

| File | Changes |
|------|---------|
| `apps/api/src/routers/symbol.router.ts` | Added bulkValidate endpoint with delta validation |
| `apps/api/src/services/control-channel.service.ts` | Added handleBulkAddSymbols handler |
| `packages/schemas/src/control/command.schema.ts` | Added 'bulk-add-symbols' to CommandTypeSchema |

## Commits

| Hash | Description |
|------|-------------|
| 99174a4 | feat(20-03): add bulkValidate endpoint for bulk symbol import |
| 78a848d | feat(20-03): add bulk-add-symbols command handler |

## Deviations from Plan

None - plan executed exactly as written.

## Requirements Coverage

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| SYM-05 | Complete | bulkValidate + bulk-add-symbols command |
| SYM-03 | Enhanced | Delta-based validation in bulkValidate |

## Testing Notes

**To test bulkValidate endpoint:**
```bash
# Via tRPC client (Admin UI)
trpc.symbol.bulkValidate.query({
  symbols: ['ETH-USD', 'SOL-USD', 'INVALID-XXX', 'BTC-USD']
})
```

**To test bulk-add-symbols command:**
```bash
# Via Redis pub/sub (after validation)
PUBLISH livermore:commands:{sub} '{"correlationId":"test","type":"bulk-add-symbols","payload":{"symbols":["ETH-USD","SOL-USD"]},"timestamp":1738367000000,"priority":15}'
```

## Next Phase Readiness

**Phase 20 Complete**

All symbol management requirements implemented:
- SYM-01: add-symbol command (20-02)
- SYM-02: remove-symbol command (20-02)
- SYM-03: validate endpoint with delta (20-01, enhanced in 20-03)
- SYM-04: search endpoint (20-01)
- SYM-05: bulk import (20-03)
- SYM-06: metrics preview (20-01)

Ready for Phase 21: Admin UI - Settings
