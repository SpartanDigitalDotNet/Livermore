/**
 * Query Action: price-spread
 *
 * Compare BTC prices across exchanges using latest candle data.
 * Shows price, staleness, and spread between exchanges.
 *
 * Usage:
 *   npx tsx .claude/actions/queries/price-spread.ts                # BTC spread across all exchanges
 *   npx tsx .claude/actions/queries/price-spread.ts --symbol ETH   # ETH spread
 *   npx tsx .claude/actions/queries/price-spread.ts --timeframe 1m # use 1m candles for fresher data
 */
import { getRedisClient } from '@livermore/cache';

const EXCHANGE_NAMES: Record<number, string> = {
  1: 'Coinbase',
  2: 'Binance',
  3: 'Binance.US',
};

// Symbol naming conventions per exchange
const SYMBOL_MAP: Record<string, Record<number, string>> = {
  BTC: { 1: 'BTC-USD', 2: 'BTCUSD', 3: 'BTCUSD' },
  ETH: { 1: 'ETH-USD', 2: 'ETHUSD', 3: 'ETHUSD' },
  SOL: { 1: 'SOL-USD', 2: 'SOLUSD', 3: 'SOLUSD' },
};

async function main() {
  const args = process.argv.slice(2);

  let baseSymbol = 'BTC';
  let timeframe = '5m';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbol' && args[i + 1]) {
      baseSymbol = args[++i].toUpperCase();
    } else if (args[i] === '--timeframe' && args[i + 1]) {
      timeframe = args[++i];
    }
  }

  const redis = getRedisClient();
  const now = Date.now();

  const symbolMap = SYMBOL_MAP[baseSymbol];
  if (!symbolMap) {
    // Fall back: try {BASE}-USD and {BASE}USD patterns
    console.log(`No symbol map for ${baseSymbol}, trying common patterns...`);
  }

  const results: { exchange: string; exchangeId: number; symbol: string; price: number; timestamp: number; age: string }[] = [];

  // Check each exchange
  for (const [idStr, name] of Object.entries(EXCHANGE_NAMES)) {
    const exchangeId = parseInt(idStr, 10);
    const symbol = symbolMap?.[exchangeId] ?? (exchangeId === 1 ? `${baseSymbol}-USD` : `${baseSymbol}USD`);
    const key = `candles:${exchangeId}:${symbol}:${timeframe}`;

    const type = await redis.type(key);
    if (type === 'none') continue;

    let candle: any = null;
    if (type === 'zset') {
      const latest = await redis.zrange(key, -1, -1);
      if (latest.length > 0) candle = JSON.parse(latest[0]);
    }

    if (!candle) continue;

    const ageMs = now - candle.timestamp;
    const ageMins = Math.floor(ageMs / 60000);
    const age = ageMins < 60 ? `${ageMins}m ago` : `${(ageMins / 60).toFixed(1)}h ago`;

    results.push({
      exchange: name,
      exchangeId,
      symbol,
      price: candle.close,
      timestamp: candle.timestamp,
      age,
    });
  }

  if (results.length === 0) {
    console.log(`No ${baseSymbol} candle data found on any exchange.`);
    await redis.quit();
    process.exit(0);
  }

  // Sort by price descending
  results.sort((a, b) => b.price - a.price);

  console.log(`=== ${baseSymbol} PRICE SPREAD (${timeframe} candles) ===\n`);

  const maxNameLen = Math.max(...results.map(r => r.exchange.length));
  for (const r of results) {
    const stale = (now - r.timestamp) > 10 * 60 * 1000 ? ' [STALE]' : '';
    console.log(`  ${r.exchange.padEnd(maxNameLen)}  $${r.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}  (${r.age})${stale}`);
  }

  if (results.length >= 2) {
    const highest = results[0];
    const lowest = results[results.length - 1];
    const diff = highest.price - lowest.price;
    const pct = (diff / lowest.price) * 100;

    console.log(`\n  Spread: $${diff.toFixed(2)} (${pct.toFixed(4)}%)`);
    console.log(`  High: ${highest.exchange} | Low: ${lowest.exchange}`);

    // Warn if any data is stale
    const staleResults = results.filter(r => (now - r.timestamp) > 10 * 60 * 1000);
    if (staleResults.length > 0) {
      console.log(`\n  ⚠ ${staleResults.map(r => r.exchange).join(', ')} data is stale — spread may not reflect real-time prices`);
    }
  } else {
    console.log(`\n  Only 1 exchange has data — no spread to compare.`);
  }

  await redis.quit();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
