import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6400');

async function dump() {
  console.log('=== DUMPING ALL CANDLES ===\n');

  const candleKeys = await redis.keys('candles:*');
  candleKeys.sort();

  for (const key of candleKeys) {
    const count = await redis.zcard(key);
    console.log(`${key}: ${count} candles`);
  }

  console.log('\n=== DUMPING ALL INDICATORS ===\n');

  const indicatorKeys = await redis.keys('indicator:*');
  indicatorKeys.sort();

  for (const key of indicatorKeys) {
    const value = await redis.get(key);
    if (value) {
      const parsed = JSON.parse(value);
      console.log(`${key}:`);
      console.log(`  timestamp: ${new Date(parsed.timestamp).toISOString()}`);
      console.log(`  value:`, parsed.value);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total candle keys: ${candleKeys.length}`);
  console.log(`Total indicator keys: ${indicatorKeys.length}`);

  await redis.quit();
}

dump().catch(console.error);
