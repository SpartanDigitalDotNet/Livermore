# Summary: Phase 29-01 Service Integration

**Status:** Complete
**Executed:** 2026-02-07

## What Was Built

Wired orphaned services from Phase 25 and 28 into the main application startup:

1. **ExchangeAdapterFactory Integration**:
   - Created `adapterFactory` instance in server.ts
   - Replaced direct `new CoinbaseAdapter()` with `adapterFactory.create(EXCHANGE_ID)`
   - Factory now looks up exchange config from database and creates correct adapter type
   - Connection status tracking wired via factory event listeners

2. **SymbolSourceService Integration**:
   - Created `symbolSourceService` instance in server.ts
   - User positions from `getAccountSymbols()` now passed to `classifyUserPositions()`
   - Symbols classified as Tier 1 (in exchange_symbols table) or Tier 2 (user overflow)
   - Logging shows tier breakdown: `{ total, tier1, tier2, excluded }`

3. **ServiceRegistry Updated**:
   - Changed `coinbaseAdapter` type from `CoinbaseAdapter` to `IExchangeAdapter`
   - Added optional fields: `adapterFactory`, `symbolSourceService`, `classifiedSymbols`
   - Enables control channel commands to access factory for future multi-exchange support

## Files Modified

- `apps/api/src/server.ts` - Integrated factory and symbol service
- `apps/api/src/services/types/service-registry.ts` - Updated types for new services

## Verification

- [x] ExchangeAdapterFactory.create() called instead of new CoinbaseAdapter()
- [x] SymbolSourceService.classifyUserPositions() called with user positions
- [x] Tier classification logged at startup
- [x] ServiceRegistry includes adapterFactory and symbolSourceService
- [x] Full turbo build passes

## Requirements Satisfied

This phase closes audit gaps, not new requirements:

- **Gap: ExchangeAdapterFactory orphaned** - Now wired into server.ts startup
- **Gap: SymbolSourceService orphaned** - Now wired into server.ts startup
- **Gap: Symbol Classification flow incomplete** - E2E flow now works

## Flow Verification

**Symbol Classification Flow (Now Complete):**
```
User positions fetched → SymbolSourceService.classifyUserPositions() →
Tier 1/2 assignment → Logged with tier counts
```

## Notes

- Currently the `exchange_symbols` table is empty, so all user positions classify as Tier 2
- When Tier 1 symbols are populated (via `refreshTier1Symbols()`), positions matching Tier 1 will use shared pool
- Hardcoded `userId = 1` remains as tech debt (deferred to v5.1 multi-user support)
