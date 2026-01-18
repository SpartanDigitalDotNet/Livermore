# Requirements: Coinbase Fee Analysis Spike

**Defined:** 2026-01-18
**Core Value:** Understand actual fee costs by symbol and over time to inform future trading decisions

## v1 Requirements

Requirements for this spike. Each maps to roadmap phases.

### Data Retrieval

- [ ] **DATA-01**: Script can fetch all filled orders from Coinbase Advanced Trade API
- [ ] **DATA-02**: Script handles pagination to retrieve complete order history
- [ ] **DATA-03**: Script fetches current fee tier via transaction_summary endpoint

### Fee Analysis by Symbol

- [ ] **SYMBOL-01**: Calculate total fees paid per trading pair (e.g., BTC-USD)
- [ ] **SYMBOL-02**: Calculate total volume traded per trading pair
- [ ] **SYMBOL-03**: Calculate effective fee rate per symbol (total_fees / filled_value as %)
- [ ] **SYMBOL-04**: Calculate average fee per trade per symbol

### Buy vs Sell Analysis

- [ ] **SIDE-01**: Separate fee totals by trade side (BUY vs SELL)
- [ ] **SIDE-02**: Compare effective fee rates between buys and sells per symbol

### Monthly Breakdown

- [ ] **MONTH-01**: Group orders by calendar month
- [ ] **MONTH-02**: Calculate monthly volume totals
- [ ] **MONTH-03**: Calculate monthly fee totals
- [ ] **MONTH-04**: Calculate monthly effective fee rate

### Output

- [ ] **OUT-01**: Display formatted tables in console output
- [ ] **OUT-02**: Generate markdown report saved to file
- [ ] **OUT-03**: Include current fee tier info in report header

## v2 Requirements

Deferred - not applicable for spike.

(None - this is a one-shot analysis)

## Out of Scope

Explicitly excluded for this spike.

| Feature | Reason |
|---------|--------|
| Database persistence | One-shot analysis, no need to store |
| Real-time fee tracking | Not a live feature |
| Fee prediction/forecasting | Just historical analysis |
| Integration with alerts | Standalone spike |
| Maker vs taker breakdown | Coinbase order response doesn't distinguish |
| Fee trend charts | Console + markdown sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase ? | Pending |
| DATA-02 | Phase ? | Pending |
| DATA-03 | Phase ? | Pending |
| SYMBOL-01 | Phase ? | Pending |
| SYMBOL-02 | Phase ? | Pending |
| SYMBOL-03 | Phase ? | Pending |
| SYMBOL-04 | Phase ? | Pending |
| SIDE-01 | Phase ? | Pending |
| SIDE-02 | Phase ? | Pending |
| MONTH-01 | Phase ? | Pending |
| MONTH-02 | Phase ? | Pending |
| MONTH-03 | Phase ? | Pending |
| MONTH-04 | Phase ? | Pending |
| OUT-01 | Phase ? | Pending |
| OUT-02 | Phase ? | Pending |
| OUT-03 | Phase ? | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 0
- Unmapped: 16 (awaiting roadmap)

---
*Requirements defined: 2026-01-18*
*Last updated: 2026-01-18 after initial definition*
