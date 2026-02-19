---
name: perseus:whale-dots
description: Scatter chart of whale BTC positions by detection date — deduped dots with glow effects
argument-hint: "[discord]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
---

<objective>
Generate a dark-themed scatter chart plotting Hyperliquid whale BTC entry prices by detection
date. Each whale is a colored dot (triangle for LONG, diamond for SHORT), sized by position.
Deduped — only first detection and subsequent position changes are plotted.
Optionally post to the whale reports Discord channel.

Data sources:
- Whale positions: `whale:{address}:latest` and `whale:{address}:snapshot:{timestamp}` keys in Redis
</objective>

<critical_rules>
- NEVER look for .env files. Use environment variables from Windows User scope.
- ALWAYS use `NODE_ENV=development` when running scripts.
- ALWAYS write scripts to `tmp/` and clean up after.
- ALWAYS use a PowerShell wrapper (.ps1) to inject env vars — bash `$env:` syntax doesn't work.
- Chart must use the dark theme (#1a1a2e background) matching @livermore/charts conventions.
- Only include whales with BTC positions > 0.01 size (skip dust/test positions).
- DEDUPLICATE: Per whale, sort by time, only keep first observation and any where direction, entry_price, or size changed.
- Discord posting requires DISCORD_WHALE_REPORTS env var (webhook URL for the whale reports channel).
</critical_rules>

<context>
## Redis Key Schema

### Whale Data
- `whale:{0xAddress}:latest` — String (JSON). Current wallet snapshot.
- `whale:{0xAddress}:snapshot:{timestamp}` — String (JSON). Historical snapshots.
- `whale:{0xAddress}:changes` — Sorted set. Position changes between snapshots.

### Whale Snapshot Schema
```typescript
interface WhaleSnapshot {
  address: string;
  alias?: string;
  timestamp: string;
  positions: WhalePosition[];
  account_value: number;
  total_margin_used: number;
  total_unrealized_pnl: number;
}

interface WhalePosition {
  coin: string;
  szi: number;
  direction: "LONG" | "SHORT";
  size: number;
  entry_price: number;
  current_price: number;
  unrealized_pnl: number;
  leverage: number;
}
```

### Known Whale Aliases (as of Feb 2026)
Nancy, Mitch, Eric, Roger, Kash, Don Jr, Liz, Rudy, Jeffery, Pam, Joe

## Chart Styling

### Whale Dot Colors
```typescript
const WHALE_COLORS = {
  'Nancy':   '#FF6B6B', // coral red
  'Mitch':   '#4ECDC4', // teal
  'Eric':    '#FFE66D', // yellow
  'Roger':   '#A78BFA', // purple
  'Kash':    '#F97316', // orange
  'Don Jr':  '#38BDF8', // sky blue
  'Liz':     '#F472B6', // pink
  'Rudy':    '#34D399', // emerald
  'Pam':     '#CBD5E1', // silver slate
  'Joe':     '#FBBF24', // amber
  'Jeffery': '#6EE7B7', // mint
};
```

### Visual Design
- LONG positions: **triangle** markers
- SHORT positions: **diamond** markers
- Dot size: scaled by `sqrt(position_size) * 4`, clamped 14–48px
- Glow effect: `shadowBlur: 12` with whale color at 50% opacity
- White border: `rgba(255,255,255,0.15)` with 1px width
- Rich text labels: arrow (green/red) + name (whale color) + size (silver) + price (gray) + PnL (green/red)
- Labels alternate left/right by price to reduce overlap
- Subtle price zone bands: faint red above current price, faint green below
- Current BTC price: dashed blue line with bordered pill label
- Canvas: 1400x800 for Discord readability

### Discord Embed
- Dynamic narrative: auto-detected sentiment (bearish/bullish), position counts, net exposure, uPnL
- Top 5 players by position size with colored PnL indicators
- Date range + dedup note in footer

## Dependencies
- `@livermore/cache` — Redis client (`getRedisClient()`)
- `@livermore/charts` — `DARK_THEME` for theme constants
- `echarts` — Chart rendering engine
- `canvas` — Server-side canvas for PNG generation
</context>

<process>
Parse $ARGUMENTS to determine mode. Default: generate and save locally.

## Step 1: Parse arguments
- `discord` flag → post to Discord after saving

Examples:
- `/perseus:whale-dots` → scatter chart, save to tmp/
- `/perseus:whale-dots discord` → scatter chart, save + post to Discord

## Step 2: Write the chart script to tmp/
Create `tmp/whale-dots.ts` that:
1. Connects to Redis via `getRedisClient()`
2. Reads all `whale:*` keys (latest + snapshot)
3. Groups observations by whale alias, sorted by time
4. Deduplicates: keeps first detection per whale + any subsequent changes in direction, entry_price, or size
5. Gets current BTC price from latest whale snapshot
6. Generates ECharts scatter chart with:
   - Per-whale series (triangle=LONG, diamond=SHORT)
   - Glow dots with shadow and white border
   - Rich text labels with PnL coloring
   - Smart label alternation (left/right by price rank)
   - Price zone bands (faint red/green)
   - Current BTC price dashed line
   - Title + subtitle with date range and stats
   - Legend sorted by position size
7. Saves PNG to `tmp/btc-whale-dots.png`
8. If discord mode: posts to Discord via DISCORD_WHALE_REPORTS webhook with dynamic narrative

## Step 3: Write PowerShell wrapper
Create `tmp/run-whale-dots.ps1`:
```powershell
$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User')
$env:DISCORD_WHALE_REPORTS = [Environment]::GetEnvironmentVariable('DISCORD_WHALE_REPORTS', 'User')
$env:NODE_ENV = 'development'
pnpm exec tsx tmp/whale-dots.ts
```

## Step 4: Execute
```bash
powershell -NoProfile -ExecutionPolicy Bypass -File "tmp/run-whale-dots.ps1"
```

## Step 5: Verify output
Read the generated PNG to confirm it rendered correctly.

## Cleanup
Always delete `tmp/whale-dots.ts`, `tmp/run-whale-dots.ps1`, and `tmp/btc-whale-dots.png` after execution.
</process>

<success_criteria>
- [ ] All whale BTC positions extracted from Redis (latest + historical snapshots)
- [ ] Positions properly deduplicated (first detection + changes only)
- [ ] Scatter chart with correct symbols, glow, and rich labels
- [ ] Price zones and current BTC price line rendered
- [ ] PNG saved to tmp/
- [ ] If discord: posted as embed with dynamic narrative
- [ ] Temporary scripts cleaned up
</success_criteria>
