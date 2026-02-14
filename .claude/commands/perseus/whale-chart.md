---
name: perseus:whale-chart
description: Generate BTC price chart with Hyperliquid whale entry-price lines and post to Discord
argument-hint: "[discord] [timeframe]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
---

<objective>
Generate a dark-themed BTC-USD candlestick chart overlaid with horizontal lines showing
Hyperliquid whale entry prices from Redis. Each whale gets a distinct color, solid line
for LONG positions, dashed for SHORT. Optionally post to the Livermore bot Discord channel.

Data sources:
- Whale positions: `whale:{address}:latest` keys in Redis (Hyperliquid perp futures)
- BTC candles: `candles:1:BTC-USD:{timeframe}` (Coinbase via Redis sorted sets)
</objective>

<critical_rules>
- NEVER look for .env files. Use environment variables from Windows User scope.
- ALWAYS use `NODE_ENV=development` when running scripts.
- ALWAYS write scripts to `tmp/` and clean up after.
- ALWAYS use a PowerShell wrapper (.ps1) to inject env vars — bash `$env:` syntax doesn't work.
- Chart must use the dark theme (#1a1a2e background) matching @livermore/charts conventions.
- Only include whales with BTC positions > 0.01 size (skip dust/test positions).
- Y-axis must extend to cover all whale entry prices, even if far from current price.
- Discord posting requires DISCORD_WHALE_REPORTS env var (webhook URL for the whale reports channel).
</critical_rules>

<context>
## Redis Key Schema

### Whale Data
- `whale:{0xAddress}:latest` — String (JSON). Current wallet snapshot.
- `whale:{0xAddress}:snapshot:{timestamp}` — String (JSON). Historical snapshots.
- `whale:{0xAddress}:changes` — Sorted set. Position changes between snapshots.
- `whale:{0xAddress}:summaries` — List. AI-generated change summaries.

### Whale Snapshot Schema
```typescript
interface WhaleSnapshot {
  address: string;        // 0x Ethereum address
  alias?: string;         // Human-readable name (e.g., "Nancy", "Mitch")
  timestamp: string;      // ISO timestamp of snapshot
  positions: WhalePosition[];
  open_orders: any[];
  account_value: number;
  total_margin_used: number;
  total_unrealized_pnl: number;
}

interface WhalePosition {
  coin: string;           // "BTC", "ETH", "SOL", etc.
  szi: number;            // Signed size (negative = SHORT)
  direction: "LONG" | "SHORT";
  size: number;           // Absolute size
  entry_price: number;
  current_price: number;
  unrealized_pnl: number;
  leverage: number;
  liquidation_price: number | null;
  margin_used: number;
}
```

### Known Whale Aliases (as of Feb 2026)
Nancy, Mitch, Eric, Roger, Kash, Don Jr, Liz, Rudy, Jeffery, Pam, Joe

### Candle Data
- `candles:1:BTC-USD:{timeframe}` — Sorted set of Coinbase candle JSON
- Available timeframes: 1m, 5m, 15m, 1h, 4h, 1d

## Chart Styling

### Whale Line Colors
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
  'Pam':     '#1F2937', // dark gray
  'Joe':     '#FBBF24', // amber
};
```

- LONG positions: **solid** lines
- SHORT positions: **dashed** lines
- Labels show: alias, direction, size, entry price, leverage

## Dependencies
- `@livermore/cache` — Redis client (`getRedisClient()`)
- `@livermore/schemas` — `CandleSchema` for candle parsing
- `@livermore/charts` — `DARK_THEME`, `CANDLE_COLORS` for theme constants
- `echarts` — Chart rendering engine
- `canvas` — Server-side canvas for PNG generation
</context>

<process>
Parse $ARGUMENTS to determine mode. Default: generate and save locally.

## Step 1: Parse arguments
- `discord` flag → post to Discord after saving
- Timeframe (default: `4h`) — can override with `1h`, `1d`, etc.

Examples:
- `/perseus:whale-chart` → 4h chart, save to tmp/
- `/perseus:whale-chart discord` → 4h chart, save + post to Discord
- `/perseus:whale-chart 1d discord` → 1d chart, save + post to Discord

## Step 2: Write the chart script to tmp/
Create `tmp/whale-chart.ts` that:
1. Connects to Redis via `getRedisClient()`
2. Reads all `whale:*:latest` keys
3. Extracts BTC positions (coin === 'BTC', size > 0.01)
4. Fetches `candles:1:BTC-USD:{timeframe}` candles
5. Generates ECharts candlestick chart with markLine for each whale entry
6. Saves PNG to `tmp/btc-whale-entries.png`
7. If discord mode: posts to Discord via DISCORD_WHALE_REPORTS webhook

Key chart details:
- Use ECharts `markLine` on the candlestick series for whale horizontal lines
- Each line labeled with: arrow (▲/▼), alias, direction, size, entry price, leverage
- Solid lines for LONG, dashed for SHORT
- Y-axis extended with min/max to cover all whale entry prices
- Volume bars at 20% opacity behind candlesticks
- 1200x700 resolution for Discord readability

## Step 3: Write PowerShell wrapper
Create `tmp/run-whale-chart.ps1`:
```powershell
$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User')
$env:DISCORD_WHALE_REPORTS = [Environment]::GetEnvironmentVariable('DISCORD_WHALE_REPORTS', 'User')
$env:NODE_ENV = 'development'
pnpm exec tsx tmp/whale-chart.ts
```

## Step 4: Execute
```bash
powershell -NoProfile -ExecutionPolicy Bypass -File "tmp/run-whale-chart.ps1"
```

## Step 5: Verify output
Read the generated PNG to confirm it rendered correctly.

## Step 6: Discord embed (if discord mode)
Post with embed containing:
- Title: "BTC — Hyperliquid Whale Entry Prices ({timeframe})"
- Description: Current BTC price + whale position table with emoji indicators
- Image attachment
- Footer: "Generated by Perseus/Livermore"

## Cleanup
Always delete `tmp/whale-chart.ts` and `tmp/run-whale-chart.ps1` after execution.
</process>

<success_criteria>
- [ ] All whale BTC positions extracted from Redis
- [ ] Candlestick chart generated with correct timeframe
- [ ] Horizontal lines for each whale with correct color, style, and label
- [ ] Y-axis covers all whale entry prices
- [ ] PNG saved to tmp/
- [ ] If discord: posted as embed with whale summary
- [ ] Temporary scripts cleaned up
</success_criteria>
