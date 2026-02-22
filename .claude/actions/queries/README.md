# Query Actions

Reusable scripts for querying database and Redis state.

## Scripts

### alerts.ts — Query alert history
```bash
NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts                        # all alerts, last 20
NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts --exchange 2           # Binance alerts
NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts --symbol BTC-USD       # BTC alerts
NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts --type macdv           # MACDV alerts only
NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts --count 50             # last 50
```

Flags can be combined:
```bash
NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts --exchange 2 --symbol BTC-USD --type macdv
```

### refresh-symbols.ts — Refresh symbol universe from CoinGecko + exchange products
```bash
NODE_ENV=development npx tsx .claude/actions/queries/refresh-symbols.ts                         # all exchanges, top 100
NODE_ENV=development npx tsx .claude/actions/queries/refresh-symbols.ts --exchange 1             # Coinbase only
NODE_ENV=development npx tsx .claude/actions/queries/refresh-symbols.ts --exchange 1 --limit 50  # Coinbase, top 50
```

Updates exchange_symbols with global ranks, liquidity scores, and market cap data. Shows top 10 symbols by rank after single-exchange refresh.
