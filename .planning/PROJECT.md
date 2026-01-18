# Coinbase Fee Analysis Spike

## What This Is

A one-shot analysis tool to understand Coinbase trading fee structure by examining historical transaction data. Fetches all filled orders, calculates fees by symbol, effective fee percentages, and monthly breakdowns showing how volume tiers affect fees. Outputs both console report and markdown file for reference.

## Core Value

Understand actual fee costs by symbol and over time to inform future trading decisions and fee projections.

## Requirements

### Validated

- ✓ Coinbase REST client with JWT authentication — existing
- ✓ Transaction summary endpoint (current fee tier, 30-day volume) — existing
- ✓ CoinbaseOrder interface with fee fields (fee, total_fees, filled_value) — existing

### Active

- [ ] Fetch all filled orders from Coinbase history
- [ ] Calculate total and average fees by symbol
- [ ] Calculate effective fee rate (fees / volume) per symbol
- [ ] Monthly breakdown showing volume and fee trends
- [ ] Console output with formatted tables
- [ ] Markdown report saved to file

### Out of Scope

- Persisting fee data to database — one-shot analysis only
- Real-time fee tracking — not a live feature
- Fee prediction/forecasting — just historical analysis
- Integration with alert system — standalone spike

## Context

Coinbase Advanced Trade API provides:
- `/api/v3/brokerage/orders/historical/batch` — can query by status (FILLED)
- `/api/v3/brokerage/transaction_summary` — current fee tier and rates
- Order response includes: `product_id`, `fee`, `total_fees`, `filled_value`, `created_time`, `side`

Fee tiers are based on 30-day trailing USD volume:
- Higher volume = lower fees
- Maker vs taker rates differ
- Fees may vary by product (need to verify)

Existing codebase has:
- `CoinbaseRestClient` in `packages/coinbase-client/src/rest/client.ts`
- `getOpenOrders()` uses the orders/historical/batch endpoint
- Can extend to query FILLED status

## Constraints

- **Spike nature**: One-shot script, not integrated into main app
- **API limits**: Coinbase has rate limits; pagination required for large histories
- **Data scope**: All history available via API (no date filtering on their end for orders)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Standalone script in scripts/ | Spike should not pollute main codebase | — Pending |
| Extend CoinbaseRestClient | Reuse existing auth and patterns | — Pending |
| Console + Markdown output | User wants both for review and reference | — Pending |

---
*Last updated: 2026-01-18 after initialization*
