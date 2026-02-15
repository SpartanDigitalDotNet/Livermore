# Query Routing

Natural language questions mapped to action scripts. When the user asks a question, find the closest match and run the command.

| Question | Command |
|----------|---------|
| Does Binance have any alerts? / Any MACDV alerts for Binance? | `NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts --exchange 2` |
| Any alerts for Coinbase? | `NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts --exchange 1` |
| Any BTC alerts? | `NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts --symbol BTC-USD` |
| Show me recent alerts | `NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts` |
| Show me Coinbase alerts from today | `NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts --exchange 1 --since today` |
| Alerts from the last 2 hours | `NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts --since 2h` |
| Binance alerts today | `NODE_ENV=development npx tsx .claude/actions/queries/alerts.ts --exchange 2 --since today` |
| Is Binance running? / Is Binance up? | `NODE_ENV=development npx tsx .claude/actions/queries/instance-status.ts --name binance` |
| Is Coinbase running? | `NODE_ENV=development npx tsx .claude/actions/queries/instance-status.ts --name coinbase` |
| What's running? / Instance status / What exchanges are up? | `NODE_ENV=development npx tsx .claude/actions/queries/instance-status.ts` |
| What candles does Binance have? / Binance candle data? | `NODE_ENV=development npx tsx .claude/actions/queries/candles.ts --exchange 2` |
| What candles does Coinbase have? | `NODE_ENV=development npx tsx .claude/actions/queries/candles.ts --exchange 1` |
| Show me BTC candles on Binance | `NODE_ENV=development npx tsx .claude/actions/queries/candles.ts --exchange 2 --symbol BTCUSD` |
| Show sample candle data for Binance | `NODE_ENV=development npx tsx .claude/actions/queries/candles.ts --exchange 2 --sample 3` |
| What indicators does Binance have? | `NODE_ENV=development npx tsx .claude/actions/queries/indicators.ts --exchange 2` |
| What indicators does Coinbase have? | `NODE_ENV=development npx tsx .claude/actions/queries/indicators.ts --exchange 1` |
| Does Binance have MACDV indicators? | `NODE_ENV=development npx tsx .claude/actions/queries/indicators.ts --exchange 2 --type macdv` |
| Show BTC indicator data on Binance | `NODE_ENV=development npx tsx .claude/actions/queries/indicators.ts --exchange 2 --symbol BTCUSD --sample 1` |
| What's closest to alerting? / Near alerts? | `NODE_ENV=development npx tsx .claude/actions/queries/near-alerts.ts` |
| What Binance symbols are near alert thresholds? | `NODE_ENV=development npx tsx .claude/actions/queries/near-alerts.ts --exchange 2` |
| What's close to alerting on the 1h? | `NODE_ENV=development npx tsx .claude/actions/queries/near-alerts.ts --timeframe 1h` |
| Why aren't Binance alerts firing? | `NODE_ENV=development npx tsx .claude/actions/queries/near-alerts.ts --exchange 2` |
| What's the BTC price difference between exchanges? / BTC spread? | `NODE_ENV=development npx tsx .claude/actions/queries/price-spread.ts` |
| What's the ETH spread across exchanges? | `NODE_ENV=development npx tsx .claude/actions/queries/price-spread.ts --symbol ETH` |
| Price difference between Coinbase and Binance? | `NODE_ENV=development npx tsx .claude/actions/queries/price-spread.ts` |
| Is there an arb opportunity? / Exchange price gap? | `NODE_ENV=development npx tsx .claude/actions/queries/price-spread.ts` |
| Discord stats / Discord usage / How's the bot doing? | `NODE_ENV=development npx tsx .claude/actions/queries/discord-stats.ts` |
| Who's using the Discord bot? | `NODE_ENV=development npx tsx .claude/actions/queries/discord-stats.ts --users` |
| Discord daily activity / Bot activity by day | `NODE_ENV=development npx tsx .claude/actions/queries/discord-stats.ts --daily` |
| What commands are popular on Discord? | `NODE_ENV=development npx tsx .claude/actions/queries/discord-stats.ts --commands` |
| Show me the network logs / Network activity | `NODE_ENV=development npx tsx .claude/actions/queries/network-logs.ts` |
| Binance network logs / Binance state transitions | `NODE_ENV=development npx tsx .claude/actions/queries/network-logs.ts --exchange binance` |
| Coinbase network logs | `NODE_ENV=development npx tsx .claude/actions/queries/network-logs.ts --exchange coinbase` |
| Any network errors? / Show network errors | `NODE_ENV=development npx tsx .claude/actions/queries/network-logs.ts --errors` |
