import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6400');

async function clearIndicators() {
  // Find all 1m indicator keys
  const keys = await redis.keys('indicator:*:*:*:1m:*');

  console.log('Found', keys.length, '1m indicator keys to delete:');
  for (const key of keys) {
    console.log(' ', key);
  }

  if (keys.length > 0) {
    await redis.del(...keys);
    console.log('\nDeleted', keys.length, 'indicator cache entries');
  }

  // Also clear the bad candles (the 0.01 H-L ones)
  console.log('\nClearing bad 1m candles with tiny H-L ranges...');

  const symbols = ['BTC-USD'];
  for (const symbol of symbols) {
    const candleKey = `candles:1:1:${symbol}:1m`;
    const candles = await redis.zrange(candleKey, 0, -1, 'WITHSCORES');

    let removed = 0;
    for (let i = 0; i < candles.length; i += 2) {
      const raw = candles[i];
      const score = candles[i + 1];
      const c = JSON.parse(raw);
      const hl = c.high - c.low;

      // Remove candles with suspiciously small H-L (< $0.10 for BTC)
      if (hl < 0.10) {
        await redis.zrem(candleKey, raw);
        console.log('  Removed candle at', new Date(c.timestamp).toISOString(), 'H-L:', hl.toFixed(2));
        removed++;
      }
    }
    console.log('Removed', removed, 'bad candles for', symbol);
  }

  console.log('\nDone. Indicators will recalculate on next candle close.');
  await redis.quit();
}

clearIndicators().catch(console.error);
