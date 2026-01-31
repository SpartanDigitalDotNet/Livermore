# Feature Landscape: v4.0 User Settings + Runtime Control

**Domain:** Trading platform settings management, admin control panel, runtime commands
**Researched:** 2026-01-31
**Overall Confidence:** HIGH (industry patterns + existing codebase alignment)

---

## Executive Summary

This research identifies features for a trading platform settings/control system with four main areas:
1. **User Settings Management** - Profile, preferences, exchange configurations stored as JSONB
2. **Admin Runtime Control Panel** - Start/stop, mode switching, service commands
3. **Symbol Management** - Scanner + manual curation hybrid approach
4. **Runtime Command Protocol** - Redis pub/sub for Admin-to-API communication

The design aligns with established trading platform patterns (3Commas, Altrady, Bitsgap) while fitting Livermore's existing architecture.

---

## Feature Category 1: User Settings Management

### Table Stakes (Must Have)

| Feature | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| **Settings JSONB Column** | Single JSONB column on users table storing all settings | Low | Already planned per PROJECT.md |
| **Settings CRUD API** | tRPC endpoints: get, update, patch settings | Low | Standard tRPC pattern |
| **Settings Schema Validation** | Zod schema for settings structure | Medium | Ensures data integrity |
| **Profile Section** | Display name, timezone, locale, date/time format | Low | Already in settings file |
| **Exchange Configuration** | Multi-exchange support with enable/disable per exchange | Medium | Existing pattern from file |
| **Credential Env Var References** | Store env var names, not actual secrets | Low | Security requirement |
| **Trading Preferences** | Risk tolerance, strategy, stop-loss/take-profit defaults | Low | From existing file |
| **Notification Preferences** | Email, Discord, push notification settings | Low | Discord already integrated |
| **Runtime Settings** | auto_start, logging verbosity, data directories | Low | Existing pattern |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Partial Updates (PATCH)** | Update single sections without overwriting entire settings | Medium | Use jsonb_set() in Postgres |
| **Settings Versioning** | Track settings changes with timestamps | Medium | Audit trail for changes |
| **Settings Export/Import** | Export settings as JSON, import to new instance | Low | Developer convenience |
| **Settings Validation Feedback** | Real-time validation errors in Admin UI | Medium | Better UX |
| **Per-Exchange Defaults** | Different risk/strategy settings per exchange | High | Multi-exchange sophistication |

### Anti-Features (Do NOT Build)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Settings History Table** | Overkill for single-user system | Single JSONB with updated_at timestamp |
| **Settings Sync Across Devices** | Only one Admin instance running | N/A - single instance |
| **Settings Encryption at Rest** | Credentials in env vars, not in settings | Keep current pattern |
| **Per-Symbol Settings** | Adds complexity without value | Global risk settings apply to all |
| **Complex ACL on Settings** | Single admin user | Simple role check sufficient |

---

## Feature Category 2: Admin Runtime Control Panel

### Table Stakes (Must Have)

| Feature | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| **Runtime Status Display** | Show API status: running, paused, mode, uptime | Low | WebSocket or polling |
| **Start/Stop Control** | Start/stop trading operations (not the process) | Medium | Pause mode, not shutdown |
| **Current Mode Display** | Show active mode: position-monitor, scalper-macdv, etc. | Low | Read from API state |
| **Mode Switching** | Change mode without restart | Medium | Via pub/sub command |
| **Active Symbols Display** | Show currently tracked symbols | Low | From scanner/curation |
| **Exchange Connection Status** | Show connected exchanges and health | Low | Heartbeat-based |
| **Last Signal Time** | Show when last signal was processed | Low | Observability |
| **Error Log Summary** | Recent errors in control panel | Low | Tail from logs |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Command History** | Log of all commands sent via control panel | Medium | Audit trail |
| **Command Confirmation** | Confirm destructive commands (clear-cache) | Low | UX safety |
| **Connection Latency Display** | Show WebSocket latency to exchanges | Medium | Observability |
| **Cache Statistics** | Show Redis cache hit/miss, memory usage | Medium | Performance insight |
| **Scheduled Commands** | Schedule mode changes (e.g., night mode) | High | Future consideration |

### Anti-Features (Do NOT Build)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Process Kill Button** | Dangerous, lose connection to control | Pause mode instead |
| **Live Code Deployment** | Security risk, out of scope | Restart for deployments |
| **Database Admin Panel** | Separate concern | Use Atlas or DBeaver |
| **Log File Editing** | Read-only is sufficient | View logs only |
| **Multi-Instance Control** | Single instance deployment | N/A |

---

## Feature Category 3: Symbol Management

### Table Stakes (Must Have)

| Feature | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| **Symbol Watchlist Display** | Show all tracked symbols with status | Low | From settings |
| **Add Symbol Manually** | Add symbol to tracking list | Low | CRUD operation |
| **Remove Symbol** | Remove from tracking (with confirmation) | Low | Prevent accidents |
| **Symbol Search** | Search available symbols from exchange | Medium | Fetch from exchange API |
| **Symbol Enable/Disable** | Toggle tracking without removal | Low | Quick pause |
| **Scanner Status** | Show if scanner is enabled, last run | Low | From settings |
| **Scanner Results Preview** | Show what scanner would add before applying | Medium | User approval |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Bulk Symbol Import** | Import symbol list from CSV/JSON | Low | Developer convenience |
| **Symbol Categories** | Tag symbols (high-cap, meme, etc.) | Medium | Organization |
| **Symbol Metrics Preview** | Show 24h volume, price before adding | Medium | Informed decisions |
| **Cross-Exchange Symbol Mapping** | Map BTC-USD (Coinbase) to BTCUSDT (Binance) | High | Multi-exchange prep |
| **Scanner Configuration UI** | Configure scanner criteria in Admin | Medium | Currently file-based |

### Anti-Features (Do NOT Build)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Automatic Symbol Discovery** | Could track garbage tokens | Manual curation required |
| **Symbol Recommendations** | AI/ML complexity unnecessary | Manual selection |
| **Symbol Performance Tracking** | Different from position tracking | Use position viewer |
| **Real-Time Symbol Price Grid** | Already have Dashboard | Use existing |
| **Symbol-Level Settings** | Per-symbol config overkill | Global settings |

---

## Feature Category 4: Runtime Command Protocol

### Table Stakes (Must Have)

| Feature | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| **Redis Pub/Sub Channel** | `livermore:commands:{identity_sub}` channel | Low | Standard Redis pattern |
| **Command: pause** | Pause all trading operations | Low | Stop processing, keep connected |
| **Command: resume** | Resume trading operations | Low | Restart processing |
| **Command: reload-settings** | Reload settings from database | Medium | Hot reload |
| **Command: switch-mode** | Change trading mode | Medium | With payload |
| **Command: add-symbol** | Add symbol to tracking dynamically | Medium | Without restart |
| **Command: remove-symbol** | Remove symbol from tracking | Medium | Clean shutdown |
| **Command: force-backfill** | Force candle backfill for symbol | Medium | Recovery operation |
| **Command: clear-cache** | Clear Redis cache (with scope) | Medium | Maintenance |
| **Command ACK** | Acknowledge command receipt | Low | Confirmation |
| **Command Result** | Return success/failure to Admin | Low | Feedback |

### Command Protocol Specification

```typescript
interface RuntimeCommand {
  id: string;              // UUID for tracking
  command: CommandType;    // Enum of valid commands
  payload?: Record<string, unknown>;  // Command-specific data
  timestamp: number;       // When sent
  source: 'admin' | 'system';  // Origin
}

type CommandType =
  | 'pause'
  | 'resume'
  | 'reload-settings'
  | 'switch-mode'
  | 'add-symbol'
  | 'remove-symbol'
  | 'force-backfill'
  | 'clear-cache'
  | 'status';              // Request current status

interface CommandResult {
  commandId: string;       // Reference to original command
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  timestamp: number;
}
```

### Redis Channel Pattern

```
Commands (Admin -> API):    livermore:commands:{identity_sub}
Responses (API -> Admin):   livermore:responses:{identity_sub}
Status (API broadcast):     livermore:status:{identity_sub}
```

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Command Queue Persistence** | Redis Streams instead of Pub/Sub | Medium | Survive disconnection |
| **Command Priority** | High-priority commands processed first | Low | pause > add-symbol |
| **Command Timeout** | Commands expire if not processed | Low | Stale prevention |
| **Batch Commands** | Multiple commands in single message | Medium | Efficiency |
| **Command Rollback** | Undo last command (where applicable) | High | Safety net |

### Anti-Features (Do NOT Build)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Azure Service Bus** | Overkill for single-instance | Redis pub/sub sufficient |
| **Command Signing** | Internal communication trusted | Identity-based channel isolation |
| **Complex Routing** | Single consumer | Direct pub/sub |
| **Command Chaining** | Complexity without benefit | Separate commands |
| **Persistent Command Log** | Memory sufficient | Ephemeral OK |

---

## Feature Category 5: Settings Admin UI

### Table Stakes (Must Have)

| Feature | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| **Form-Based Editor** | Structured forms for common settings | Medium | User-friendly |
| **Exchange Config Forms** | Add/edit exchange credentials (env var names) | Medium | Per-exchange fields |
| **JSON Raw Editor** | Advanced editor for power users | Low | Monaco or json-edit-react |
| **Save/Discard Buttons** | Explicit save action with discard option | Low | Standard pattern |
| **Validation Errors** | Show field-level validation errors | Medium | UX requirement |
| **Loading States** | Show loading during save operations | Low | UX polish |
| **Success/Error Toast** | Feedback on save operations | Low | UX requirement |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Side-by-Side Editor** | Form + JSON view simultaneously | Medium | Power user feature |
| **Settings Diff View** | Show changes before saving | Medium | Safety feature |
| **Settings Templates** | Quick-apply preset configurations | Medium | Onboarding help |
| **Keyboard Shortcuts** | Ctrl+S to save, Esc to discard | Low | Developer experience |
| **Auto-Save Draft** | Save work-in-progress to localStorage | Low | Prevent data loss |

### Anti-Features (Do NOT Build)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Full React Admin Framework** | Overkill for single settings page | Custom components |
| **Schema Auto-Generation** | Static schema sufficient | Manual Zod schema |
| **Multi-User Conflict Resolution** | Single admin user | N/A |
| **Settings Approval Workflow** | Solo developer | Direct save |
| **Comment/Documentation on Fields** | Tooltips sufficient | Inline hints |

---

## Trading Mode Specifications

### Mode: position-monitor (Default)

**Purpose:** Monitor existing positions, fire alerts on price movements
**Behavior:**
- Track symbols in positions table only
- Calculate indicators for position symbols
- Fire alerts on signal conditions
- No new position entry

### Mode: scalper-macdv

**Purpose:** Active MACD-V signal hunting across watchlist
**Behavior:**
- Track all symbols in watchlist
- Calculate MACD-V across all timeframes
- Fire alerts on crossovers and momentum shifts
- Higher alert volume expected

### Mode: scalper-orderbook (Stub for v4.0)

**Purpose:** Order book imbalance detection (v4.1 implementation)
**Behavior:**
- Subscribe to Level2 WebSocket channel
- Detect bid/ask imbalances
- Fire alerts on significant imbalances
- **v4.0: Stub only, returns "not implemented"**

### Mode Configuration

```typescript
interface ModeConfig {
  mode: 'position-monitor' | 'scalper-macdv' | 'scalper-orderbook';
  symbolSource: 'positions' | 'watchlist' | 'scanner';
  indicatorsEnabled: string[];  // ['macdv', 'rsi', etc.]
  alertThresholds: {
    macdvCrossover: boolean;
    momentumShift: boolean;
    // ...
  };
}
```

---

## Settings Schema Structure

Based on existing `data/DESKTOP-5FK78SF.settings.json`:

```typescript
interface UserSettings {
  // Identity (synced from Clerk)
  sub: string;

  // User Profile
  perseus_profile: {
    public_name: string;
    description: string;
    primary_exchange: string;
    trading_mode: 'paper' | 'live';
    currency: string;
    timezone: string;
    locale: string;
    date_format: string;
    time_format: string;
    risk_tolerance: 'low' | 'medium' | 'high';
    investment_style: 'conservative' | 'balanced' | 'aggressive';
    notification_preferences: string;
    trade_settings: {
      trading_strategy: string;
      preferred_geographies: string;
      blacklisted_geographies: string;
      trading_hours_utc: string;
      trading_days: string;
      max_daily_trades: number;
      stop_loss_percentage: number;
      take_profit_percentage: number;
      preferred_timeframes: string;
    };
    discord_integration: {
      enabled: boolean;
      webhook_url_environment_variable: string;
    };
  };

  // Runtime Configuration
  livermore_runtime: {
    auto_start: boolean;
    logging: {
      data_directory: string;
      log_directory: string;
      verbosity_level: string;
    };
  };

  // Exchange Configurations
  exchanges: Record<string, {
    enabled: boolean;
    ApiKeyEnvironmentVariableName: string;
    SecretEnvironmentVariableName: string;
    PasswordEnvironmentVariableName?: string;  // For KuCoin
  }>;

  // Symbol Management
  load_positions_from_exchange: boolean;
  position_symbols: string[];
  position_min_value_usd: number;
  position_refresh_hours: number;
  portfolio_symbols_last_update: string;

  // Scanner
  scanner_to_maintain_symbols_enabled: boolean;
  scanner_symbols_last_update: string;
  scanner_exchange: string;
  scanner_auto_restart_services: boolean;

  // Watchlist
  symbols: string[];
  sparse_symbols: string[];  // Low-priority symbols
}
```

---

## Feature Dependencies

```
Settings JSONB Column
    |
    v
Settings tRPC CRUD  <---> Settings Zod Schema
    |
    v
Admin Settings UI (Form + JSON)
    |
    v
Runtime Command Protocol (reload-settings)
    |
    v
API Command Handler
```

```
Symbol Management
    |
    +---> Scanner (background)
    |         |
    |         v
    +---> Symbol Watchlist <---> Admin Symbol UI
              |
              v
          add-symbol / remove-symbol commands
              |
              v
          API Symbol Handler
```

---

## MVP Recommendation

### Phase 1: Foundation
1. Add `settings` JSONB column to users table (or use existing user_settings table)
2. Settings tRPC endpoints (get, update)
3. Basic Admin Settings page with JSON editor
4. Command channel setup (pub/sub)

### Phase 2: Runtime Control
5. Runtime Control Panel component
6. Pause/resume commands
7. Mode switching
8. Status display

### Phase 3: Symbol Management
9. Symbol list component
10. Add/remove symbol commands
11. Scanner integration (display only)

### Phase 4: Polish
12. Form-based settings editor
13. Settings validation feedback
14. Command history

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Settings migration from file | Low | Medium | One-time migration script |
| Pub/sub message loss | Low | Low | Commands are idempotent |
| Mode switch during active trade | Medium | High | Pause before switch |
| Invalid settings saved | Medium | Medium | Zod validation before save |
| Scanner adds unwanted symbols | Low | Low | Require manual approval |

---

## Sources

**Trading Platform Patterns:**
- [B2COPY Admin Panel (2026)](https://www.globenewswire.com/news-release/2026/01/21/3222491/0/en/B2COPY-Unveils-Completely-Redesigned-Admin-Panel-with-Enhanced-Speed-and-Control.html) - Modern admin panel architecture
- [3Commas Risk Management](https://3commas.io/blog/ai-trading-bot-risk-management-guide) - Bot settings best practices
- [Altrady Watchlists](https://www.altrady.com/features/watchlists-and-price-alerts) - Symbol management patterns
- [Bitsgap Platform](https://bitsgap.com/) - Multi-exchange bot configuration

**Technical Implementation:**
- [PostgreSQL JSONB Patterns (AWS)](https://aws.amazon.com/blogs/database/postgresql-as-a-json-database-advanced-patterns-and-best-practices/) - JSONB best practices
- [JSONB Flexible Modeling](https://medium.com/@richardhightower/jsonb-postgresqls-secret-weapon-for-flexible-data-modeling-cf2f5087168f) - Schema patterns
- [Redis Pub/Sub for Trading](https://medium.com/@sw.lee_41764/harnessing-the-power-of-redis-for-efficient-trading-operations-a-detailed-look-at-redis-pub-sub-2951b3c50c11) - Command protocol patterns
- [Redis Real-Time Trading](https://redis.io/blog/real-time-trading-platform-with-redis-enterprise/) - Architecture patterns

**React Admin UI:**
- [React Admin JsonSchemaForm](https://marmelab.com/react-admin/JsonSchemaForm.html) - JSON form editing
- [json-edit-react](https://github.com/CarlosNZ/json-edit-react) - JSONB editor component
- [React Admin May 2025 Update](https://marmelab.com/blog/2025/05/21/react-admin-may-2025-update.html) - Latest patterns

**Existing Codebase:**
- `data/DESKTOP-5FK78SF.settings.json` - Current settings structure
- `packages/database/schema.sql` - Database schema
- `.planning/PROJECT.md` - v4.0 requirements
