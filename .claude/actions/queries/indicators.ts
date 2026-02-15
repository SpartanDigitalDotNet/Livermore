/**
 * Query Action: indicators
 *
 * List indicator keys in Redis for an exchange, optionally filtered by symbol/type.
 *
 * Key pattern (from packages/cache/src/keys.ts):
 *   Tier 1: indicator:{exchangeId}:{symbol}:{timeframe}:{type}[:params]  (string/JSON)
 *
 * Usage:
 *   npx tsx .claude/actions/queries/indicators.ts --exchange 2                # all Binance indicators
 *   npx tsx .claude/actions/queries/indicators.ts --exchange 2 --symbol BTCUSD
 *   npx tsx .claude/actions/queries/indicators.ts --exchange 2 --type macdv
 *   npx tsx .claude/actions/queries/indicators.ts --exchange 2 --sample 3     # show 3 sample values
 */
import { getRedisClient } from '@livermore/cache';

async function main() {
  const args = process.argv.slice(2);

  let exchangeId: number | null = null;
  let symbol: string | null = null;
  let type: string | null = null;
  let sample = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exchange' && args[i + 1]) {
      exchangeId = parseInt(args[++i], 10);
    } else if (args[i] === '--symbol' && args[i + 1]) {
      symbol = args[++i];
    } else if (args[i] === '--type' && args[i + 1]) {
      type = args[++i];
    } else if (args[i] === '--sample' && args[i + 1]) {
      sample = parseInt(args[++i], 10) || 0;
    }
  }

  if (!exchangeId) {
    console.error('Usage: indicators.ts --exchange <id> [--symbol <sym>] [--type <type>] [--sample <n>]');
    process.exit(1);
  }

  const redis = getRedisClient();

  // indicator:{exchangeId}:{symbol}:{timeframe}:{type}[:params]
  let pattern: string;
  if (symbol && type) {
    pattern = `indicator:${exchangeId}:${symbol}:*:${type}*`;
  } else if (symbol) {
    pattern = `indicator:${exchangeId}:${symbol}:*`;
  } else if (type) {
    pattern = `indicator:${exchangeId}:*:*:${type}*`;
  } else {
    pattern = `indicator:${exchangeId}:*`;
  }

  const keys = await redis.keys(pattern);

  console.log(`=== INDICATORS (exchangeId=${exchangeId}${symbol ? `, symbol=${symbol}` : ''}${type ? `, type=${type}` : ''}) ===`);
  console.log(`Keys found: ${keys.length}\n`);

  if (keys.length === 0) {
    console.log('No indicator keys found.');
    await redis.quit();
    process.exit(0);
  }

  // Parse keys to extract symbols, timeframes, types
  const symbols = new Set<string>();
  const timeframes = new Set<string>();
  const types = new Set<string>();
  const byType: Record<string, { symbols: Set<string>; timeframes: Set<string> }> = {};

  for (const key of keys) {
    // indicator:{exchangeId}:{symbol}:{timeframe}:{type}[:params]
    const parts = key.split(':');
    const sym = parts[2];
    const tf = parts[3];
    const t = parts[4];
    symbols.add(sym);
    timeframes.add(tf);
    types.add(t);
    if (!byType[t]) byType[t] = { symbols: new Set(), timeframes: new Set() };
    byType[t].symbols.add(sym);
    byType[t].timeframes.add(tf);
  }

  console.log(`Symbols: ${symbols.size}`);
  console.log(`Timeframes: ${[...timeframes].sort().join(', ')}`);
  console.log(`Types: ${[...types].sort().join(', ')}`);
  console.log('');

  // Summary by type
  for (const [t, info] of Object.entries(byType).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${t}: ${info.symbols.size} symbols x ${[...info.timeframes].sort().join(', ')}`);
  }

  // Optionally show sample data
  if (sample > 0 && keys.length > 0) {
    console.log(`\n=== SAMPLE DATA (${sample} keys) ===`);
    for (const key of keys.slice(0, sample)) {
      const val = await redis.get(key);
      console.log(`\n${key}`);
      if (val) {
        try {
          const parsed = JSON.parse(val);
          console.log(`  ${JSON.stringify(parsed, null, 2).split('\n').join('\n  ')}`);
        } catch {
          console.log(`  ${val}`);
        }
      }
    }
  }

  await redis.quit();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
