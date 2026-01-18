# Research Summary: Coinbase Fee Analysis

## Stack

**Existing (reuse):**
- TypeScript + Node.js runtime
- `CoinbaseRestClient` with JWT auth
- Pino logging, Zod validation

**Additions needed:**
- None - existing stack sufficient for one-shot analysis script

## Key Features

**Table Stakes:**
- Total fees by symbol
- Effective fee rate (fees / volume) per symbol
- Monthly volume and fee breakdown
- Current fee tier display

**Differentiators (optional):**
- Maker vs taker breakdown (if data available)
- Buy vs sell fee comparison
- Fee trend visualization

**Anti-features (skip for spike):**
- Database persistence
- Real-time tracking
- Fee prediction

## Architecture

**Recommended approach:**
1. Extend `CoinbaseRestClient` with `getFilledOrders()` method
2. Create standalone script in `scripts/analyze-fees.ts`
3. Script fetches orders → aggregates → outputs report

**Data flow:**
```
Coinbase API → getFilledOrders() → aggregate by symbol/month → format output → console + markdown
```

## Pitfalls to Avoid

1. **Pagination**: Orders API returns paginated results - must loop through all pages
2. **Fee fields**: Use `total_fees` not `fee` for accurate totals
3. **Volume calculation**: Use `filled_value` for USD volume
4. **Date parsing**: Coinbase uses ISO timestamps - convert properly for monthly grouping
5. **Rate limits**: Add small delays between paginated requests if needed

---
*Summary created: 2026-01-18*
