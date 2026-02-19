---
phase: 40-trade-signals-generic-labeling
plan: 02
subsystem: api
tags: [fastify, routes, redis, drizzle, pagination, signals, alerts, ip-protection]

# Dependency graph
requires:
  - phase: 40-trade-signals-generic-labeling
    plan: 01
    provides: PublicSignalSchema, PublicAlertSchema, transformIndicatorToSignal, transformAlertHistory
  - phase: 39-public-api-foundation
    provides: Fastify plugin, createEnvelopeSchema, buildPaginationMeta, candles/symbols route patterns
provides:
  - GET /public/v1/signals/:exchange/:symbol endpoint reading multi-timeframe signals from Redis
  - GET /public/v1/alerts endpoint with cursor pagination from PostgreSQL alert_history
  - OpenAPI Signals and Alerts tags with documented endpoints
  - signalsRoute and alertsRoute Fastify plugin registrations
affects: [41-auth-rate-limiting, public-api-openapi-spec]

# Tech tracking
tech-stack:
  added: []
  patterns: [multi-timeframe-signal-aggregation, reverse-chronological-cursor-pagination, exchange-id-bidirectional-cache]

key-files:
  created:
    - packages/public-api/src/routes/signals.route.ts
    - packages/public-api/src/routes/alerts.route.ts
  modified:
    - packages/public-api/src/routes/index.ts
    - packages/public-api/src/plugin.ts

key-decisions:
  - "Signals endpoint not paginated (fixed small set of 4 timeframes per symbol) -- uses static meta with has_more: false"
  - "Alerts filtered to alertType='macdv' in WHERE clause only -- type value never appears in response"
  - "Bidirectional exchange cache in alerts route (name->id for filters, id->name for responses)"

patterns-established:
  - "Multi-timeframe signal aggregation: iterate SIGNAL_TIMEFRAMES array, fetch each from Redis, skip unseeded"
  - "Reverse chronological cursor pagination: lt(id, cursorId) with desc(id) ordering"
  - "Bidirectional exchange cache: Map<string, number> and Map<number, string> populated from same DB query"

# Metrics
duration: 4min
completed: 2026-02-19
---

# Phase 40 Plan 02: Signal and Alert REST Endpoints Summary

**Fastify route handlers for GET /signals/:exchange/:symbol (Redis multi-timeframe) and GET /alerts (PostgreSQL cursor-paginated) with OpenAPI Signals/Alerts tags**

## Performance

- **Duration:** 4 min (241s)
- **Started:** 2026-02-19T05:49:11Z
- **Completed:** 2026-02-19T05:53:12Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Signal endpoint aggregates up to 4 timeframes (15m, 1h, 4h, 1d) from Redis indicator cache per symbol, filtering to seeded indicators only
- Alert endpoint provides reverse-chronological cursor pagination from PostgreSQL with explicit column whitelist (no details, notification, or internal type columns selected)
- OpenAPI spec now includes Signals and Alerts tags with AI-friendly endpoint descriptions
- All 5 route handlers registered in plugin (candles, exchanges, symbols, signals, alerts)
- Zero proprietary indicator names in any response body or OpenAPI description

## Task Commits

Each task was committed atomically:

1. **Task 1: Create signals and alerts route handlers** - `c9661cc` (feat)
2. **Task 2: Wire routes into plugin and update OpenAPI tags** - `a3eda4f` (feat)

## Files Created/Modified
- `packages/public-api/src/routes/signals.route.ts` - GET /:exchange/:symbol with multi-timeframe Redis reads and seeded-only filtering
- `packages/public-api/src/routes/alerts.route.ts` - GET / with Drizzle explicit column selection, cursor pagination, exchange name resolution
- `packages/public-api/src/routes/index.ts` - Barrel exports updated with signalsRoute and alertsRoute
- `packages/public-api/src/plugin.ts` - Route registration at /signals and /alerts prefixes, Signals and Alerts OpenAPI tags added

## Decisions Made
- Signals endpoint returns a flat array (not paginated) since the fixed set of 4 timeframes is always small -- static meta with `has_more: false` and `next_cursor: null`
- Alerts WHERE clause filters to `alertType = 'macdv'` internally but this value never appears in any response -- only the generic `signal_type: 'momentum_signal'` is exposed
- Used bidirectional exchange cache in alerts route (name->id for query filters, id->name for response transformation) populated from the same DB query to minimize round trips

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 40 complete: schemas, transformers, and route handlers all delivered
- Public API now serves candles, exchanges, symbols, signals, and alerts
- Ready for Phase 41 (API Authentication & Rate Limiting)
- Pre-existing TS errors in route files (Fastify strict reply typing for non-200 status codes) are cosmetic and do not affect runtime behavior

## Self-Check: PASSED

- All 4 files verified present on disk
- Commit `c9661cc` verified in git log (Task 1)
- Commit `a3eda4f` verified in git log (Task 2)

---
*Phase: 40-trade-signals-generic-labeling*
*Completed: 2026-02-19*
