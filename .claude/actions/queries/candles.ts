/**
 * Query Action: candles
 *
 * List candle keys in Redis for an exchange, optionally filtered by symbol/timeframe.
 * Shows key count, symbols, and timeframes found.
 *
 * Key patterns (from packages/cache/src/keys.ts):
 *   Tier 1: candles:{exchangeId}:{symbol}:{timeframe}        (sorted set)
 *   Tier 2: usercandles:{userId}:{exchangeId}:{symbol}:{tf}  (sorted set)
 *   Legacy: candles:{userId}:{exchangeId}:{symbol}:{tf}      (sorted set)
 *
 * Usage:
 *   npx tsx .claude/actions/queries/candles.ts --exchange 2              # all Binance candles
 *   npx tsx .claude/actions/queries/candles.ts --exchange 1 --symbol BTC-USD  # Coinbase BTC
 *   npx tsx .claude/actions/queries/candles.ts --exchange 2 --sample 3   # show 3 sample values
 */
import { getRedisClient } from '@livermore/cache';

async function main() {
  const args = process.argv.slice(2);

  let exchangeId: number | null = null;
  let symbol: string | null = null;
  let sample = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exchange' && args[i + 1]) {
      exchangeId = parseInt(args[++i], 10);
    } else if (args[i] === '--symbol' && args[i + 1]) {
      symbol = args[++i];
    } else if (args[i] === '--sample' && args[i + 1]) {
      sample = parseInt(args[++i], 10) || 0;
    }
  }

  if (!exchangeId) {
    console.error('Usage: candles.ts --exchange <id> [--symbol <sym>] [--sample <n>]');
    process.exit(1);
  }

  const redis = getRedisClient();

  // Tier 1: candles:{exchangeId}:{symbol}:{timeframe}
  const tier1Pattern = symbol
    ? `candles:${exchangeId}:${symbol}:*`
    : `candles:${exchangeId}:*`;

  const keys = await redis.keys(tier1Pattern);

  console.log(`=== CANDLES (exchangeId=${exchangeId}${symbol ? `, symbol=${symbol}` : ''}) ===`);
  console.log(`Tier 1 keys found: ${keys.length}\n`);

  if (keys.length === 0) {
    console.log('No candle keys found.');
    await redis.quit();
    process.exit(0);
  }

  // Parse keys to extract symbols and timeframes
  // Tier 1 format: candles:{exchangeId}:{symbol}:{timeframe}
  const symbols = new Set<string>();
  const timeframes = new Set<string>();
  const bySymbol: Record<string, string[]> = {};

  for (const key of keys) {
    const parts = key.split(':');
    const sym = parts[2];
    const tf = parts[3];
    symbols.add(sym);
    timeframes.add(tf);
    if (!bySymbol[sym]) bySymbol[sym] = [];
    bySymbol[sym].push(tf);
  }

  console.log(`Symbols: ${symbols.size}`);
  console.log(`Timeframes: ${[...timeframes].sort().join(', ')}`);
  console.log('');

  // List symbols with their timeframes
  const sortedSymbols = [...symbols].sort();
  for (const sym of sortedSymbols) {
    const tfs = bySymbol[sym].sort();
    console.log(`  ${sym}: ${tfs.join(', ')}`);
  }

  // Optionally show sample candle data
  if (sample > 0 && keys.length > 0) {
    console.log(`\n=== SAMPLE DATA (${sample} keys) ===`);
    for (const key of keys.slice(0, sample)) {
      const count = await redis.zcard(key);
      const latest = await redis.zrange(key, -1, -1);
      console.log(`\n${key} (${count} candles)`);
      if (latest.length > 0) {
        const candle = JSON.parse(latest[0]);
        console.log(`  Latest: ${JSON.stringify(candle, null, 2).split('\n').join('\n  ')}`);
      }
    }
  }

  await redis.quit();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
