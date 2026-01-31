# Milestone v4.0: User Settings + Runtime Control

**Status:** In Progress
**Phases:** 17-22
**Total Plans:** TBD

## Overview

Enables user-specific configuration stored in PostgreSQL with JSONB, establishes Redis pub/sub control channels for Admin-to-API command communication, implements runtime mode management and symbol management, and builds Admin UI for settings editing, runtime control, and symbol curation.

## Phases

### Phase 17: Settings Infrastructure

**Goal**: User settings can be stored, retrieved, and managed via database with type-safe schema
**Depends on**: None (foundation phase)
**Plans**: 3 plans

Plans:
- [x] 17-01-PLAN.md — Database column + Zod schema foundation
- [x] 17-02-PLAN.md — Core CRUD endpoints (get/update/patch)
- [x] 17-03-PLAN.md — Export/Import endpoints

**Requirements:**
- SET-01: `settings` JSONB column added to users table with version field
- SET-02: Zod schema for UserSettings type matching existing file structure
- SET-03: tRPC `settings.get` endpoint returns user settings
- SET-04: tRPC `settings.update` endpoint replaces entire settings
- SET-05: tRPC `settings.patch` endpoint updates specific sections via jsonb_set
- SET-06: Settings export endpoint (download as JSON)
- SET-07: Settings import endpoint (upload JSON, validate, save)

**Success Criteria:**
1. User can retrieve their settings via tRPC call and receive typed JSON response
2. User can replace entire settings document and changes persist across API restarts
3. User can patch individual sections without affecting other settings
4. User can export settings to JSON file and import settings from JSON file
5. Invalid settings (schema mismatch) are rejected with clear validation errors

---

### Phase 18: Control Channel Foundation

**Goal**: Admin UI can send commands to API and receive acknowledgments and results
**Depends on**: Phase 17 (settings schema informs command payloads)
**Plans**: 3 plans

Plans:
- [x] 18-01-PLAN.md — Schemas + channel key helpers
- [x] 18-02-PLAN.md — ControlChannelService with pub/sub + priority queue
- [x] 18-03-PLAN.md — Server integration (startup/shutdown)

**Requirements:**
- RUN-01: Redis pub/sub command channel `livermore:commands:{identity_sub}`
- RUN-02: Redis pub/sub response channel `livermore:responses:{identity_sub}`
- RUN-03: Command handler in API processes incoming commands
- RUN-10: Command ACK returned immediately on receipt
- RUN-11: Command result returned after execution
- RUN-12: Command timeout - commands expire if not processed within 30s
- RUN-13: Command priority - pause/resume processed before other commands

**Success Criteria:**
1. Admin UI can publish a command and receive immediate ACK within 100ms
2. Admin UI receives execution result after command completes (success or failure)
3. Commands that exceed 30s timeout are marked as expired and not processed
4. Pause command is processed before queued non-priority commands
5. Multiple commands can be queued and processed in priority order

---

### Phase 19: Runtime Commands

**Goal**: API runtime can be controlled via pub/sub commands without restart
**Depends on**: Phase 18 (command channel and handler exist)
**Plans**: 3 plans

Plans:
- [x] 19-01-PLAN.md — ServiceRegistry interface + constructor injection
- [x] 19-02-PLAN.md — Server integration + pause/resume handlers (RUN-04, RUN-05)
- [x] 19-03-PLAN.md — Remaining handlers: reload-settings, switch-mode, force-backfill, clear-cache (RUN-06 to RUN-09)

**Requirements:**
- RUN-04: `pause` command stops WebSocket connections and indicator processing
- RUN-05: `resume` command restarts WebSocket and indicator processing
- RUN-06: `reload-settings` command reloads settings from database
- RUN-07: `switch-mode` command changes runtime mode (position-monitor, scalper-macdv, scalper-orderbook stub)
- RUN-08: `force-backfill` command triggers candle backfill for specified symbol
- RUN-09: `clear-cache` command clears Redis cache with scope (all, symbol, timeframe)

**Success Criteria:**
1. User can pause API and WebSocket connections stop (no new data processing)
2. User can resume API and WebSocket connections restart from current state
3. User can reload settings and API uses new values without restart
4. User can switch between position-monitor and scalper-macdv modes at runtime
5. User can force backfill for a symbol and candle data is refreshed from exchange

---

### Phase 20: Symbol Management

**Goal**: Users can dynamically add/remove symbols with exchange validation
**Depends on**: Phase 18 (command channel for add/remove), Phase 17 (settings store symbol list)
**Plans**: 3 plans

Plans:
- [ ] 20-01-PLAN.md — Symbol router for Admin UI (search, validate, metrics)
- [ ] 20-02-PLAN.md — Command handlers (add-symbol, remove-symbol)
- [ ] 20-03-PLAN.md — Bulk import validation and command

**Requirements:**
- SYM-01: `add-symbol` command adds symbol to watchlist dynamically
- SYM-02: `remove-symbol` command removes symbol from watchlist
- SYM-03: Admin verifies symbols against exchange API before saving (delta-based validation)
- SYM-04: Symbol search endpoint fetches available symbols from user's exchange
- SYM-05: Bulk symbol import from JSON array
- SYM-06: Symbol metrics preview (24h volume, price) before adding

**Success Criteria:**
1. User can add a valid symbol and API starts processing it within 30s
2. User can remove a symbol and API stops processing it (cache cleanup)
3. Invalid symbols (not on exchange) are rejected with clear error message
4. User can search available symbols from their configured exchange
5. User can bulk import multiple symbols and see validation results for each

---

### Phase 21: Admin UI - Settings

**Goal**: Users can view and edit their settings through intuitive form and JSON interfaces
**Depends on**: Phase 17 (settings endpoints exist)
**Plans**: TBD

**Requirements:**
- UI-SET-01: Settings page with form-based editor for common settings
- UI-SET-02: JSON raw editor for power users (Monaco or json-edit-react)
- UI-SET-03: Side-by-side view (form + JSON simultaneously)
- UI-SET-04: Settings diff view shows changes before saving
- UI-SET-05: Save/discard buttons with validation error display
- UI-SET-06: Loading states and success/error toasts

**Success Criteria:**
1. User can edit common settings via form fields without knowing JSON structure
2. Power user can edit raw JSON with syntax highlighting and validation
3. User can see form changes reflected in JSON view in real-time
4. User can review diff of changes before committing save
5. User receives clear feedback on save success or validation errors

---

### Phase 22: Admin UI - Control Panel + Symbols

**Goal**: Users can monitor and control API runtime and manage their symbol watchlist
**Depends on**: Phase 19 (runtime commands), Phase 20 (symbol management)
**Plans**: TBD

**Requirements:**
- UI-CTL-01: Runtime status display (running/paused, current mode, uptime)
- UI-CTL-02: Pause/resume buttons
- UI-CTL-03: Mode switcher dropdown
- UI-CTL-04: Active symbols count and list
- UI-CTL-05: Exchange connection status indicators
- UI-CTL-06: Command history panel (recent commands + results)
- UI-CTL-07: Confirmation dialog for destructive commands (clear-cache)
- UI-SYM-01: Symbol watchlist display with enable/disable toggles
- UI-SYM-02: Add symbol with search + validation against exchange
- UI-SYM-03: Remove symbol with confirmation
- UI-SYM-04: Bulk import modal (paste JSON, validate, preview)
- UI-SYM-05: Scanner status display (enabled, last run, exchange)
- UI-SYM-06: Symbol metrics display (volume, price) on hover/expand

**Success Criteria:**
1. User can see current API status (running/paused, mode, uptime) at a glance
2. User can pause and resume API with single button click
3. User can switch runtime mode from dropdown and see confirmation
4. User can view, add, and remove symbols from watchlist
5. User can see command history with timestamps and results
6. Destructive actions require confirmation dialog before execution

---

## Progress

| Phase | Name | Status | Plans |
|-------|------|--------|-------|
| 17 | Settings Infrastructure | Complete | 3/3 |
| 18 | Control Channel Foundation | Complete | 3/3 |
| 19 | Runtime Commands | Complete | 3/3 |
| 20 | Symbol Management | Planned | 0/3 |
| 21 | Admin UI - Settings | Pending | 0/? |
| 22 | Admin UI - Control Panel + Symbols | Pending | 0/? |

---

## Requirement Coverage

| Category | Requirements | Phase | Count |
|----------|--------------|-------|-------|
| Settings Infrastructure | SET-01 to SET-07 | 17 | 7 |
| Control Channel | RUN-01, RUN-02, RUN-03, RUN-10 to RUN-13 | 18 | 7 |
| Runtime Commands | RUN-04 to RUN-09 | 19 | 6 |
| Symbol Management | SYM-01 to SYM-06 | 20 | 6 |
| Admin UI Settings | UI-SET-01 to UI-SET-06 | 21 | 6 |
| Admin UI Control | UI-CTL-01 to UI-CTL-07 | 22 | 7 |
| Admin UI Symbols | UI-SYM-01 to UI-SYM-06 | 22 | 6 |

**Total:** 45 requirements mapped to 6 phases

---

_For current project status, see .planning/PROJECT.md_
