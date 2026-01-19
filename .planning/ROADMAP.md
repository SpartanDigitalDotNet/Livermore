# Roadmap: Coinbase Fee Analysis Spike

## Overview

Three-phase spike to analyze Coinbase trading fees. Phase 1 retrieves all filled orders and fee tier data from Coinbase API. Phase 2 calculates fee metrics by symbol, trade side, and month. Phase 3 formats output for console and saves markdown report.

## Phases

### Phase 1: Data Retrieval

**Goal:** Script can fetch complete order history and current fee tier from Coinbase

**Dependencies:** None (starting phase)

**Requirements:** DATA-01, DATA-02, DATA-03

**Plans:** 1 plan

Plans:
- [x] 01-01-PLAN.md — Add getFilledOrders() to client and create analyze-fees spike script

**Success Criteria:**
1. Running script retrieves all filled orders from Coinbase API (not just first page)
2. Script displays current fee tier and 30-day volume from transaction_summary endpoint
3. Script handles pagination transparently - user sees complete order count

---

### Phase 2: Fee Analysis

**Goal:** All fee metrics calculated and available for reporting

**Dependencies:** Phase 1 (needs order data)

**Requirements:** SYMBOL-01, SYMBOL-02, SYMBOL-03, SYMBOL-04, SIDE-01, SIDE-02, MONTH-01, MONTH-02, MONTH-03, MONTH-04

**Plans:** 1 plan

Plans:
- [ ] 02-01-PLAN.md — Add calculation functions and integrate into analyze-fees spike

**Success Criteria:**
1. User can see total fees, volume, and effective fee rate for each symbol traded
2. User can compare fee totals and rates between BUY and SELL orders per symbol
3. User can see monthly breakdown showing volume, fees, and effective rate over time
4. All calculations use correct fields (total_fees for fees, filled_value for volume)

---

### Phase 3: Output Generation

**Goal:** Results formatted for console viewing and saved as markdown reference

**Dependencies:** Phase 2 (needs calculated metrics)

**Requirements:** OUT-01, OUT-02, OUT-03

**Success Criteria:**
1. Console displays formatted tables for symbol summary, side comparison, and monthly breakdown
2. Running script creates markdown file in predictable location (e.g., reports/fee-analysis.md)
3. Report header shows current fee tier info (tier name, rates, 30-day volume)

---

## Progress

| Phase | Status | Requirements | Completed |
|-------|--------|--------------|-----------|
| 1 - Data Retrieval | Complete | 3 | 3/3 |
| 2 - Fee Analysis | Planned | 10 | 0/10 |
| 3 - Output Generation | Not Started | 3 | 0/3 |

**Total:** 3/16 requirements complete

---
*Roadmap created: 2026-01-18*
*Last updated: 2026-01-18 after Phase 2 planning*
