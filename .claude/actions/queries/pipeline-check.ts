/**
 * Pipeline Check Action
 *
 * Deep health check of the data pipeline for a given exchange:
 * - Key counts (candles, indicators, tickers) across key format patterns
 * - Candle freshness for top symbols
 * - Pub/sub roundtrip test
 * - Live update detection over a wait period
 *
 * Usage:
 *   NODE_ENV=development npx tsx .claude/actions/queries/pipeline-check.ts
 *   NODE_ENV=development npx tsx .claude/actions/queries/pipeline-check.ts --exchange 3
 *   NODE_ENV=development npx tsx .claude/actions/queries/pipeline-check.ts --exchange 1 --wait 30
 */
import { getRedisClient } from '@livermore/cache';

const args = process.argv.slice(2);
function getFlag(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const exchangeId = parseInt(getFlag('exchange', '3'));
const waitSeconds = parseInt(getFlag('wait', '15'));

async function main() {
  const redis = getRedisClient();
  await new Promise(r => setTimeout(r, 2000));

  const exchangeLabel = exchangeId === 1 ? 'Coinbase' : exchangeId === 2 ? 'Binance' : exchangeId === 3 ? 'Binance.US' : `Exchange ${exchangeId}`;
  console.log(`=== PIPELINE CHECK: ${exchangeLabel} (exchangeId=${exchangeId}) ===\n`);

  // 1. Key counts
  console.log('--- Key Counts ---');
  const keyPatterns = [
    { label: 'Candles (exchange-scoped)', pattern: `candles:${exchangeId}:*` },
    { label: 'Candles (user-scoped)', pattern: `candles:1:${exchangeId}:*` },
    { label: 'Indicators (exchange-scoped)', pattern: `indicator:${exchangeId}:*` },
    { label: 'Indicators (user-scoped)', pattern: `indicator:1:${exchangeId}:*` },
    { label: 'Tickers', pattern: `ticker:${exchangeId}:*` },
  ];

  for (const { label, pattern } of keyPatterns) {
    const keys = await redis.keys(pattern);
    console.log(`  ${label}: ${keys.length}`);
  }

  // 2. Candle freshness for top symbols
  console.log('\n--- Candle Freshness (5m) ---');
  const topSymbols = exchangeId === 1
    ? ['BTC-USD', 'ETH-USD', 'SOL-USD']
    : ['BTCUSD', 'ETHUSD', 'SOLUSD'];

  for (const sym of topSymbols) {
    // Try both key formats
    for (const prefix of [`candles:${exchangeId}`, `candles:1:${exchangeId}`]) {
      const key = `${prefix}:${sym}:5m`;
      const count = await redis.zcard(key);
      if (count > 0) {
        const latest = await redis.zrange(key, -1, -1, 'WITHSCORES');
        const latestTs = latest.length >= 2 ? parseInt(latest[1]) : 0;
        const age = latestTs ? Math.floor((Date.now() - latestTs) / 1000) : -1;
        console.log(`  ${key}: ${count} candles | latest: ${new Date(latestTs).toISOString()} | age: ${age}s`);
      }
    }
  }

  // 3. Indicator sample
  console.log('\n--- Indicator Sample ---');
  for (const sym of topSymbols.slice(0, 2)) {
    for (const prefix of [`indicator:${exchangeId}`, `indicator:1:${exchangeId}`]) {
      const key = `${prefix}:${sym}:5m:macd-v`;
      const data = await redis.get(key);
      if (data) {
        const parsed = JSON.parse(data);
        const macdV = parsed?.value?.macdV;
        const stage = parsed?.params?.stage;
        console.log(`  ${key} | macdV: ${macdV?.toFixed(1) ?? 'N/A'} | stage: ${stage ?? 'N/A'}`);
      }
    }
  }

  // 4. Pub/sub roundtrip test
  console.log('\n--- Pub/Sub Roundtrip ---');
  const sub = redis.duplicate();
  let roundtripOk = false;

  sub.on('message', () => { roundtripOk = true; });
  const testCh = `channel:test:pipeline-check:${Date.now()}`;
  await sub.subscribe(testCh);
  await new Promise(r => setTimeout(r, 300));
  await redis.publish(testCh, 'ping');
  await new Promise(r => setTimeout(r, 1000));
  console.log(`  Roundtrip: ${roundtripOk ? '✅ WORKS' : '❌ FAILED'}`);
  await sub.unsubscribe();
  sub.disconnect();

  // 5. Live pub/sub traffic
  console.log(`\n--- Live Pub/Sub (${waitSeconds}s) ---`);
  const sub2 = redis.duplicate();
  let msgCount = 0;
  const channelCounts: Record<string, number> = {};

  sub2.on('pmessage', (_pat: string, channel: string) => {
    msgCount++;
    // Group by type prefix
    const parts = channel.split(':');
    const type = parts.length >= 3 ? `${parts[0]}:${parts[1]}` : channel;
    channelCounts[type] = (channelCounts[type] || 0) + 1;
  });

  await sub2.psubscribe(`channel:*:${exchangeId}:*`, `channel:*:1:${exchangeId}:*`);

  for (let i = 0; i < Math.ceil(waitSeconds / 5); i++) {
    await new Promise(r => setTimeout(r, 5000));
    process.stdout.write(`  ${(i + 1) * 5}s: ${msgCount} msgs\n`);
  }

  console.log(`  Total: ${msgCount} messages`);
  for (const [type, count] of Object.entries(channelCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
  sub2.disconnect();

  // 6. Live candle update check
  console.log(`\n--- Live Candle Update (${waitSeconds}s) ---`);
  const beforeCounts: Record<string, number> = {};
  for (const sym of topSymbols) {
    const key = `candles:${exchangeId}:${sym}:5m`;
    const latest = await redis.zrange(key, -1, -1, 'WITHSCORES');
    beforeCounts[sym] = latest.length >= 2 ? parseInt(latest[1]) : 0;
  }

  await new Promise(r => setTimeout(r, waitSeconds * 1000));

  for (const sym of topSymbols) {
    const key = `candles:${exchangeId}:${sym}:5m`;
    const latest = await redis.zrange(key, -1, -1, 'WITHSCORES');
    const afterTs = latest.length >= 2 ? parseInt(latest[1]) : 0;
    const updated = afterTs > beforeCounts[sym];
    console.log(`  ${sym}: ${updated ? '✅ NEW CANDLE' : '⏳ same period'} | latest: ${new Date(afterTs).toISOString()}`);
  }

  // Verdict
  console.log('\n=== VERDICT ===');
  const candleKeys = await redis.keys(`candles:${exchangeId}:*`);
  const indicatorKeys = await redis.keys(`indicator:${exchangeId}:*`);

  if (candleKeys.length > 0 && indicatorKeys.length > 0 && roundtripOk) {
    if (msgCount > 0) {
      console.log('✅ Pipeline fully operational — data + pub/sub flowing');
    } else {
      console.log('⚠️  Data in cache, pub/sub roundtrip OK, but no live pub/sub traffic detected');
      console.log('   (may need to wait for next 5m candle close)');
    }
  } else if (candleKeys.length > 0) {
    console.log('⚠️  Candle data exists but indicators/pub/sub may not be flowing');
  } else {
    console.log('❌ No data — check if handleStart completed');
  }

  await redis.quit();
}

main().catch(e => { console.error(e); process.exit(1); });
