import { validateEnv } from '@livermore/utils';
import { createRedisClient, testRedisConnection } from '@livermore/cache';

async function main() {
  const config = validateEnv();
  const redis = createRedisClient(config);

  console.log('Connecting to Redis...');
  await testRedisConnection(redis);
  console.log('Connected!\n');

  // Scan all macd-v indicator keys for exchange 1 (Coinbase)
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', 'indicator:1:*:*:macd-v', 'COUNT', 200);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');

  if (keys.length === 0) {
    console.log('No MACD-V keys found');
    await redis.quit();
    return;
  }

  // Fetch all values
  interface MacdvEntry {
    symbol: string;
    timeframe: string;
    macdV: number;
    signal: number;
    histogram: number;
    timestamp: number;
  }

  const entries: MacdvEntry[] = [];

  for (const key of keys) {
    const val = await redis.get(key);
    if (!val) continue;
    try {
      const parsed = JSON.parse(val);
      entries.push({
        symbol: parsed.symbol,
        timeframe: parsed.timeframe,
        macdV: parsed.value.macdV,
        signal: parsed.value.signal,
        histogram: parsed.value.histogram,
        timestamp: parsed.timestamp,
      });
    } catch { /* skip unparseable */ }
  }

  // Group by timeframe, find oversold (macdV < -100)
  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];

  for (const tf of timeframes) {
    const tfEntries = entries.filter((e) => e.timeframe === tf);
    const oversold = tfEntries.filter((e) => e.macdV < -100).sort((a, b) => a.macdV - b.macdV);

    console.log(`\n=== ${tf} — ${oversold.length} oversold (MACD-V < -100) of ${tfEntries.length} symbols ===`);
    if (oversold.length === 0) {
      console.log('  None');
      continue;
    }
    for (const e of oversold) {
      const age = Math.round((Date.now() - e.timestamp) / 60000);
      console.log(`  ${e.symbol.padEnd(12)} MACD-V: ${e.macdV.toFixed(1).padStart(8)}  Signal: ${e.signal.toFixed(1).padStart(8)}  Hist: ${e.histogram.toFixed(1).padStart(8)}  (${age}m ago)`);
    }
  }

  // Also show deeply oversold across all timeframes (< -200)
  const deeplyOversold = entries.filter((e) => e.macdV < -200).sort((a, b) => a.macdV - b.macdV);
  if (deeplyOversold.length > 0) {
    console.log(`\n=== DEEPLY OVERSOLD (MACD-V < -200) ===`);
    for (const e of deeplyOversold) {
      console.log(`  ${e.symbol.padEnd(12)} [${e.timeframe}] MACD-V: ${e.macdV.toFixed(1).padStart(8)}  Signal: ${e.signal.toFixed(1).padStart(8)}  Hist: ${e.histogram.toFixed(1).padStart(8)}`);
    }
  }

  console.log(`\n--- Total: ${entries.length} indicator entries across ${new Set(entries.map(e => e.symbol)).size} symbols ---`);

  await redis.quit();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
