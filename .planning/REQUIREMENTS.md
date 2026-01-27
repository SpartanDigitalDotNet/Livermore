# Requirements: Livermore Trading Platform

**Defined:** 2026-01-26
**Core Value:** Data accuracy and timely alerts

## v3.0 Requirements

Requirements for Admin UI + IAM Foundation milestone.

### Database Workflow

- [x] **DB-01**: Atlas `sandbox` environment configured in `atlas.hcl` with PG_SANDBOX_* variables
- [x] **DB-02**: `apply-schema-sandbox.ps1` script deploys schema to Azure PostgreSQL (Sandbox)
- [x] **DB-03**: `sync-schema.ps1` runs Atlas apply then Drizzle pull (single command workflow)
- [x] **DB-04**: ARCHITECTURE.md updated to reflect Atlas-only migrations (Drizzle migrations banned)

### IAM Schema

- [x] **IAM-01**: Users table extended with `identity_provider` VARCHAR(20) — OAuth provider name
- [x] **IAM-02**: Users table extended with `identity_sub` VARCHAR(255) — Provider's user ID
- [x] **IAM-03**: Users table extended with `display_name` VARCHAR(100) — User's display name from provider
- [x] **IAM-04**: Users table extended with `identity_picture_url` TEXT — Profile picture URL from provider
- [x] **IAM-05**: Users table extended with `role` VARCHAR(20) DEFAULT 'user' — User role (admin, user, subscriber_basic, subscriber_pro)
- [x] **IAM-06**: Users table extended with `last_login_at` TIMESTAMP — Last login timestamp

### Authentication

- [x] **AUTH-01**: `@clerk/fastify` plugin registered in Fastify server (import order: dotenv first)
- [x] **AUTH-02**: tRPC context includes auth object from `getAuth(req)`
- [x] **AUTH-03**: `protectedProcedure` middleware created, checks `ctx.auth.userId`
- [x] **AUTH-04**: Clerk webhook endpoint `/webhooks/clerk` syncs users on `user.created`
- [x] **AUTH-05**: Clerk webhook syncs user data on `user.updated` events

### Admin UI

- [ ] **UI-01**: MACD-V portfolio viewer — displays portfolio analysis (symbols, prices, MACD-V values, signals)
- [ ] **UI-02**: Log viewer — displays error/warning logs from Livermore
- [ ] **UI-03**: Trade signals viewer — displays triggered alerts with timestamp, symbol, signal type
- [ ] **UI-04**: Clerk sign-in component with Google OAuth

### Documentation

- [ ] **DOC-01**: `docs/KAIA-IAM-HANDOFF.md` — full context document for Kaia's AI workflow

## v3.1 Requirements

Deferred to next milestone.

### API Authentication

- **AUTH-06**: API key authentication path for PerseusWeb (Kaia's trading UI)
- **AUTH-07**: JWT validation for PerseusWeb tokens

### Trading Contracts

- **TRADE-01**: Order model (buy/sell, limit/market, quantity, price)
- **TRADE-02**: Position model (symbol, quantity, entry price, P&L)
- **TRADE-03**: WebSocket contract for real-time data to PerseusWeb

## Out of Scope

| Feature | Reason |
|---------|--------|
| API key auth for PerseusWeb | Deferred to v3.1 — focus on Clerk first |
| Trading execution | Monitoring only for v3.0 |
| Paper trading | Requires trading contracts (v3.1) |
| Multi-exchange adapters | Separate milestone after v3.1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | 11 | Complete |
| DB-02 | 11 | Complete |
| DB-03 | 11 | Complete |
| DB-04 | 11 | Complete |
| IAM-01 | 12 | Complete |
| IAM-02 | 12 | Complete |
| IAM-03 | 12 | Complete |
| IAM-04 | 12 | Complete |
| IAM-05 | 12 | Complete |
| IAM-06 | 12 | Complete |
| AUTH-01 | 13 | Complete |
| AUTH-02 | 13 | Complete |
| AUTH-03 | 13 | Complete |
| AUTH-04 | 14 | Complete |
| AUTH-05 | 14 | Complete |
| UI-01 | 15 | Pending |
| UI-02 | 15 | Pending |
| UI-03 | 15 | Pending |
| UI-04 | 15 | Pending |
| DOC-01 | 16 | Pending |

**Coverage:**
- v3.0 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-01-26*
*Last updated: 2026-01-26 - Phase 14 complete (AUTH-04, AUTH-05)*
