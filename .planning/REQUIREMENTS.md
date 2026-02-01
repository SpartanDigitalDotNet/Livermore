# Requirements: Livermore Trading Platform

**Defined:** 2026-01-31
**Core Value:** Data accuracy and timely alerts

## v4.0 Requirements

Requirements for User Settings + Runtime Control milestone.

### Settings Infrastructure

- [x] **SET-01**: `settings` JSONB column added to users table with version field
- [x] **SET-02**: Zod schema for UserSettings type matching existing file structure
- [x] **SET-03**: tRPC `settings.get` endpoint returns user settings
- [x] **SET-04**: tRPC `settings.update` endpoint replaces entire settings
- [x] **SET-05**: tRPC `settings.patch` endpoint updates specific sections via jsonb_set
- [x] **SET-06**: Settings export endpoint (download as JSON)
- [x] **SET-07**: Settings import endpoint (upload JSON, validate, save)

### Runtime Control

- [x] **RUN-01**: Redis pub/sub command channel `livermore:commands:{identity_sub}`
- [x] **RUN-02**: Redis pub/sub response channel `livermore:responses:{identity_sub}`
- [x] **RUN-03**: Command handler in API processes incoming commands
- [x] **RUN-04**: `pause` command stops WebSocket connections and indicator processing
- [x] **RUN-05**: `resume` command restarts WebSocket and indicator processing
- [x] **RUN-06**: `reload-settings` command reloads settings from database
- [x] **RUN-07**: `switch-mode` command changes runtime mode (position-monitor, scalper-macdv, scalper-orderbook stub)
- [x] **RUN-08**: `force-backfill` command triggers candle backfill for specified symbol
- [x] **RUN-09**: `clear-cache` command clears Redis cache with scope (all, symbol, timeframe)
- [x] **RUN-10**: Command ACK returned immediately on receipt
- [x] **RUN-11**: Command result returned after execution
- [x] **RUN-12**: Command timeout — commands expire if not processed within 30s
- [x] **RUN-13**: Command priority — pause/resume processed before other commands

### Symbol Management

- [x] **SYM-01**: `add-symbol` command adds symbol to watchlist dynamically
- [x] **SYM-02**: `remove-symbol` command removes symbol from watchlist
- [x] **SYM-03**: Admin verifies symbols against exchange API before saving (delta-based validation)
- [x] **SYM-04**: Symbol search endpoint fetches available symbols from user's exchange
- [x] **SYM-05**: Bulk symbol import from JSON array
- [x] **SYM-06**: Symbol metrics preview (24h volume, price) before adding

### Admin UI - Settings

- [x] **UI-SET-01**: Settings page with form-based editor for common settings
- [x] **UI-SET-02**: JSON raw editor for power users (Monaco or json-edit-react)
- [x] **UI-SET-03**: Side-by-side view (form + JSON simultaneously)
- [x] **UI-SET-04**: Settings diff view shows changes before saving
- [x] **UI-SET-05**: Save/discard buttons with validation error display
- [x] **UI-SET-06**: Loading states and success/error toasts

### Admin UI - Control Panel

- [ ] **UI-CTL-01**: Runtime status display (running/paused, current mode, uptime)
- [ ] **UI-CTL-02**: Pause/resume buttons
- [ ] **UI-CTL-03**: Mode switcher dropdown
- [ ] **UI-CTL-04**: Active symbols count and list
- [ ] **UI-CTL-05**: Exchange connection status indicators
- [ ] **UI-CTL-06**: Command history panel (recent commands + results)
- [ ] **UI-CTL-07**: Confirmation dialog for destructive commands (clear-cache)

### Admin UI - Symbols

- [ ] **UI-SYM-01**: Symbol watchlist display with enable/disable toggles
- [ ] **UI-SYM-02**: Add symbol with search + validation against exchange
- [ ] **UI-SYM-03**: Remove symbol with confirmation
- [ ] **UI-SYM-04**: Bulk import modal (paste JSON, validate, preview)
- [ ] **UI-SYM-05**: Scanner status display (enabled, last run, exchange)
- [ ] **UI-SYM-06**: Symbol metrics display (volume, price) on hover/expand

## v4.1 Requirements

Deferred to next milestone.

### Orderbook Imbalance

- **OB-01**: WebSocket Level2 channel subscription
- **OB-02**: Orderbook imbalance detection algorithm
- **OB-03**: Imbalance alerts with configurable thresholds

### Multi-Exchange Adapters

- **EXCH-01**: Binance.com adapter implementation
- **EXCH-02**: Binance.us adapter implementation

### Security Hardening

- **SEC-01**: Convert indicator.router.ts to protectedProcedure
- **SEC-02**: Convert alert.router.ts to protectedProcedure
- **SEC-03**: Convert position.router.ts to protectedProcedure

## Out of Scope

| Feature | Reason |
|---------|--------|
| Orderbook imbalance implementation | Stub only in v4.0 — full implementation v4.1 |
| Azure Service Bus | Redis pub/sub sufficient for single-instance |
| Multi-instance API | Single API instance per user |
| Settings history/audit log | Single JSONB with updated_at sufficient |
| Per-symbol settings | Global settings apply to all symbols |
| Router auth hardening | Tech debt accepted, defer to v4.1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SET-01 | 17 | Complete |
| SET-02 | 17 | Complete |
| SET-03 | 17 | Complete |
| SET-04 | 17 | Complete |
| SET-05 | 17 | Complete |
| SET-06 | 17 | Complete |
| SET-07 | 17 | Complete |
| RUN-01 | 18 | Complete |
| RUN-02 | 18 | Complete |
| RUN-03 | 18 | Complete |
| RUN-04 | 19 | Complete |
| RUN-05 | 19 | Complete |
| RUN-06 | 19 | Complete |
| RUN-07 | 19 | Complete |
| RUN-08 | 19 | Complete |
| RUN-09 | 19 | Complete |
| RUN-10 | 18 | Complete |
| RUN-11 | 18 | Complete |
| RUN-12 | 18 | Complete |
| RUN-13 | 18 | Complete |
| SYM-01 | 20 | Complete |
| SYM-02 | 20 | Complete |
| SYM-03 | 20 | Complete |
| SYM-04 | 20 | Complete |
| SYM-05 | 20 | Complete |
| SYM-06 | 20 | Complete |
| UI-SET-01 | 21 | Complete |
| UI-SET-02 | 21 | Complete |
| UI-SET-03 | 21 | Complete |
| UI-SET-04 | 21 | Complete |
| UI-SET-05 | 21 | Complete |
| UI-SET-06 | 21 | Complete |
| UI-CTL-01 | 22 | Pending |
| UI-CTL-02 | 22 | Pending |
| UI-CTL-03 | 22 | Pending |
| UI-CTL-04 | 22 | Pending |
| UI-CTL-05 | 22 | Pending |
| UI-CTL-06 | 22 | Pending |
| UI-CTL-07 | 22 | Pending |
| UI-SYM-01 | 22 | Pending |
| UI-SYM-02 | 22 | Pending |
| UI-SYM-03 | 22 | Pending |
| UI-SYM-04 | 22 | Pending |
| UI-SYM-05 | 22 | Pending |
| UI-SYM-06 | 22 | Pending |

**Coverage:**
- v4.0 requirements: 45 total
- Mapped to phases: 45
- Unmapped: 0

---
*Requirements defined: 2026-01-31*
