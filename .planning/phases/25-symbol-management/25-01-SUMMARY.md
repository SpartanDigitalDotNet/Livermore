# Summary: Phase 25-01 Symbol Management

**Status:** Complete
**Executed:** 2026-02-07

## What Was Built

Implemented two-tier symbol sourcing with automatic de-duplication:

1. **Database: `exchange_symbols` table**
   - Stores Tier 1 symbols per exchange (top N by 24h volume)
   - Columns: exchangeId, symbol, baseCurrency, quoteCurrency, volume24h, volumeRank, isActive
   - Unique constraint on (exchange_id, symbol)
   - Index for volume-based queries

2. **SymbolSourceService** (`apps/api/src/services/symbol-source.service.ts`):
   - `getTier1Symbols()` - Get top N symbols by volume (shared pool)
   - `classifyUserPositions(symbols)` - Classify user positions into Tier 1 or 2
   - `getMergedSymbols(userPositions)` - Combined list with de-duplication
   - `refreshTier1Symbols(volumeData)` - Update volume rankings from exchange
   - `isInTier1(symbol)` - Check if symbol is in shared pool
   - `getSymbolTier(symbol)` - Get tier classification

3. **De-duplication Logic** (SYM-04):
   - User positions matching Tier 1 symbols use shared data (no duplicate writes)
   - Only positions NOT in Tier 1 go to Tier 2 (user overflow with TTL)

## Files Created/Modified

- `packages/database/schema.sql` - Added exchange_symbols table
- `packages/database/src/schema/exchange-symbols.ts` - TypeScript schema
- `packages/database/src/schema/index.ts` - Added export
- `apps/api/src/services/symbol-source.service.ts` - Symbol source service

## Verification

- [x] exchange_symbols table defined in schema.sql
- [x] TypeScript schema exports ExchangeSymbol type
- [x] SymbolSourceService provides merged symbol list
- [x] De-duplication: Tier 1 matches use shared pool
- [x] Tier 2: Non-Tier-1 user positions
- [x] Full turbo build passes

## Requirements Satisfied

- **SYM-01**: Tier 1 symbol list - Top N by 24h volume (exchange_symbols table)
- **SYM-02**: Tier 2 user positions - classifyUserPositions() de-dupes against Tier 1
- **SYM-04**: De-duplication logic - getMergedSymbols() ensures no duplicate data

## Usage Example

```typescript
const symbolService = new SymbolSourceService(1); // exchangeId = 1

// Get Tier 1 symbols (shared pool)
const tier1 = await symbolService.getTier1Symbols();
// [{ symbol: 'BTC-USD', tier: 1, volumeRank: 1, volume24h: 1000000 }, ...]

// Classify user positions
const userPositions = ['BTC-USD', 'OBSCURE-USD'];
const classified = await symbolService.classifyUserPositions(userPositions);
// BTC-USD → tier: 1 (de-duped)
// OBSCURE-USD → tier: 2 (user overflow)

// Get all symbols to monitor
const allSymbols = await symbolService.getMergedSymbols(userPositions);
```
