# Research Summary: Livermore v4.0 User Settings + Runtime Control

**Synthesized:** 2026-01-31
**Research Files:** STACK.md, FEATURES.md, V4-ARCHITECTURE.md, v4-PITFALLS.md
**Overall Confidence:** HIGH

---

## Executive Summary

Livermore v4.0 adds user-specific settings stored as JSONB on the `users` table, with Redis pub/sub enabling Admin UI to send runtime commands (pause, resume, mode switch) to the API process. This is a well-understood architectural pattern used by trading platforms like 3Commas and Bitsgap. The existing codebase already has mature Redis pub/sub patterns for candle and indicator events, so the control channel follows the same conventions with minimal new infrastructure.

The recommended approach is a hybrid architecture: frequently-queried fields (like `runtime_mode`, `is_paused`) as top-level columns with indexes, while flexible configuration (symbols, alerts, thresholds) lives in a versioned JSONB column. This balances query performance with schema flexibility. The critical insight is that pause mode must keep the command subscriber alive - stopping everything defeats the ability to receive a resume command.

The primary risks are: (1) tenant data leakage if userId is not consistently included in queries and cache keys, (2) Redis pub/sub message loss during disconnection requiring an ack pattern, and (3) JSONB schema evolution without a version field causing crashes when reading old data. All three are well-documented pitfalls with established prevention patterns.

---

## Key Findings

### From STACK.md

| Technology | Decision | Rationale |
|------------|----------|-----------|
| react-hook-form + @hookform/resolvers | ADD | Best TypeScript DX, integrates with existing Zod schemas |
| drizzle-orm JSONB | KEEP | Already supports `$type<T>()` for type-safe JSONB |
| ioredis pub/sub | KEEP | Already used for candle close events, just add control channel |
| @livermore/coinbase-client | KEEP | `getProducts()` already exists, extend for scanner |

**No new backend dependencies required.** Only add `react-hook-form` and `@hookform/resolvers` to the admin package.

**Critical Pattern:** Separate Redis clients for pub/sub vs regular operations - subscriber mode blocks all non-subscribe commands.

### From FEATURES.md

**Table Stakes (Must Have):**
- Settings CRUD tRPC endpoints
- Settings JSONB column on users table
- Runtime status display (running/paused/mode)
- Pause/resume/mode-switch commands
- Symbol watchlist display + add/remove
- Command acknowledgment protocol
- Form-based settings editor in Admin

**Differentiators:**
- Partial settings updates via `jsonb_set()`
- Settings versioning with migration functions
- Command history audit trail
- Settings diff view before save

**Anti-Features (Do NOT Build):**
- Process kill button (use pause instead)
- Per-symbol settings (global settings sufficient)
- Automatic symbol discovery without approval
- Complex ACL (single admin user)
- Settings encryption at rest (credentials in env vars only)

**Trading Modes Defined:**
1. `position-monitor` - Default, monitors existing positions
2. `scalper-macdv` - Active signal hunting on watchlist
3. `scalper-orderbook` - Stub for v4.1 (returns "not implemented")

### From V4-ARCHITECTURE.md

**Component Structure:**

| Component | Location | Responsibility |
|-----------|----------|----------------|
| Settings Router | `apps/api/src/routers/settings.router.ts` | CRUD for user settings |
| Control Router | `apps/api/src/routers/control.router.ts` | Publish commands to Redis |
| Command Handler | `apps/api/src/services/command-handler.service.ts` | Subscribe and dispatch commands |
| Runtime Mode Manager | `apps/api/src/services/runtime-mode-manager.service.ts` | Coordinate pause/resume/mode switch |
| Settings Loader | `apps/api/src/services/settings-loader.service.ts` | Load/cache PostgreSQL settings |

**Channel Naming Convention:**
```
channel:control:{userId}     # Admin -> API commands
channel:ack:{userId}:{cmdId} # API -> Admin acknowledgments
```

**State Machine:**
```
PAUSED <--pause/resume--> RUNNING (position-monitor | scalper-macdv | scalper-orderbook)
```

**Key Insight:** Command subscriber NEVER stops, even when paused. Only data services (WebSocket, indicators, alerts) pause.

### From v4-PITFALLS.md

**Critical Pitfalls (Severity: HIGH):**

| Pitfall | Impact | Prevention |
|---------|--------|------------|
| Tenant data leakage via missing userId | Security breach | Audit all hardcoded `TEST_USER_ID = 1`, user-scope all channels/keys |
| Redis pub/sub message loss | Commands ignored | Ack pattern + state polling fallback |
| JSONB schema evolution without versioning | Crash on old data | Version field in JSONB, migration on read |
| Pause stops command subscriber | Can't resume | Separate control plane (always running) from data plane |
| Cache key format change | All cached data lost | Verify user IDs before upgrade, keep primary user as ID 1 |

**Moderate Pitfalls:**
- Credential env var name validation failures (validate at save time)
- Race condition between settings update and active processes (atomic reads)
- Admin UI showing stale state (refresh on ack)
- JSONB query performance without indexes (hybrid schema with top-level columns)

---

## Implications for Roadmap

### Suggested Phase Structure

Based on dependencies identified in the research, the recommended build order is:

**Phase 1: Settings Infrastructure**
- Add `settings` JSONB column to users table (via Atlas migration)
- Create `UserSettingsSchema` in `@livermore/schemas` with version field
- Implement `SettingsLoader` service
- Modify `server.ts` to load settings on startup instead of hardcoded values
- **Delivers:** Database foundation, typed settings, startup integration
- **Pitfalls to avoid:** JSONB versioning (Pitfall 4), user_settings table confusion (Pitfall 14)
- **Research needed:** None - standard patterns

**Phase 2: Settings tRPC + Control Channel**
- Create `settings.router.ts` with get/update/reset endpoints
- Add `controlChannel()` to `packages/cache/src/keys.ts`
- Create `control.router.ts` for publishing commands
- Create `command-handler.service.ts` (basic structure)
- **Delivers:** API for settings CRUD, command infrastructure
- **Pitfalls to avoid:** Subscriber connection leaks (Pitfall 3), channel naming (Pitfall 10)
- **Research needed:** None - follows existing candle pub/sub pattern

**Phase 3: Runtime Mode Manager**
- Create `runtime-mode-manager.service.ts` with state machine
- Implement pause/resume (keeping command subscriber alive)
- Implement mode switching
- Wire up existing services (CoinbaseAdapter, IndicatorService, AlertService)
- **Delivers:** Pause/resume/mode-switch working end-to-end
- **Pitfalls to avoid:** Pause stops everything (Pitfall 5), race conditions (Pitfall 8)
- **Research needed:** None - state machine pattern well-documented

**Phase 4: Symbol Management**
- Add/remove symbol commands
- Scanner integration (fetch top symbols by volume)
- Symbol list component in Admin UI
- **Delivers:** Dynamic symbol management without restart
- **Pitfalls to avoid:** Scanner auto-add without approval (anti-feature)
- **Research needed:** None - extends existing `getProducts()` API

**Phase 5: Admin UI Settings**
- Install react-hook-form in admin package
- Settings page with form-based editor
- Control panel component (status, pause/resume, mode switch)
- Command ack + refresh pattern
- **Delivers:** Full Admin control panel
- **Pitfalls to avoid:** Stale UI state (Pitfall 9)
- **Research needed:** None - standard React patterns

### Research Flags

| Phase | Research Needed | Rationale |
|-------|-----------------|-----------|
| Phase 1 | NO | Standard JSONB + Drizzle pattern |
| Phase 2 | NO | Follows existing pub/sub pattern in codebase |
| Phase 3 | NO | State machine pattern well-documented |
| Phase 4 | NO | Extends existing Coinbase client |
| Phase 5 | NO | Standard React Hook Form |

All patterns are well-documented with existing codebase examples. No `/gsd:research-phase` commands needed.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All libraries either already in codebase or well-documented (react-hook-form) |
| Features | HIGH | Feature list derived from industry patterns (3Commas, Bitsgap) + PROJECT.md |
| Architecture | HIGH | Extends existing patterns (Redis pub/sub, tRPC routers, services) |
| Pitfalls | HIGH | All pitfalls sourced from official docs (Redis, PostgreSQL) and AWS whitepapers |

### Gaps to Address During Planning

1. **user_settings table vs users.settings column**: Current codebase has `user_settings` table (global key-value). Need to clarify: keep both (app_settings vs user_settings), or consolidate.

2. **Primary user ID verification**: Before deployment, verify your database user ID is 1 to avoid cache key migration issues.

3. **Env var name conventions**: Document expected format for credential env var names (e.g., `Coinbase_ApiKeyId`, `Coinbase_PrivateKey`).

---

## Sources

### Official Documentation (HIGH confidence)
- [Drizzle ORM PostgreSQL Column Types](https://orm.drizzle.team/docs/column-types/pg)
- [ioredis GitHub - Pub/Sub](https://github.com/redis/ioredis)
- [Redis Pub/Sub Documentation](https://redis.io/docs/latest/develop/pubsub/)
- [React Hook Form useForm](https://react-hook-form.com/docs/useform)
- [@hookform/resolvers](https://github.com/react-hook-form/resolvers)
- [Coinbase Advanced Trade API](https://docs.cdp.coinbase.com/advanced-trade/docs/api-overview/)
- [AWS SaaS Tenant Isolation](https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/tenant-isolation.html)

### PostgreSQL JSONB Patterns (HIGH confidence)
- [When To Avoid JSONB - Heap](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema)
- [PostgreSQL JSONB Indexing Strategies](https://www.rickychilcott.com/2025/09/22/postgresql-indexing-strategies-for-jsonb-columns/)
- [Zero-Downtime JSONB Migration](https://medium.com/@shinyjai2011/zero-downtime-postgresql-jsonb-migration-a-practical-guide-for-scalable-schema-evolution-9f74124ef4a1)

### Trading Platform References (MEDIUM confidence)
- [3Commas Risk Management](https://3commas.io/blog/ai-trading-bot-risk-management-guide)
- [Altrady Watchlists](https://www.altrady.com/features/watchlists-and-price-alerts)
- [Bitsgap Platform](https://bitsgap.com/)

### Existing Codebase
- `packages/cache/src/keys.ts` - Channel naming patterns
- `apps/api/src/server.ts` - Service initialization
- `apps/api/src/services/indicator-calculation.service.ts` - Pub/sub subscriber pattern
- `data/DESKTOP-5FK78SF.settings.json` - Current settings structure

---

*Research synthesis complete. Ready for roadmap creation.*
