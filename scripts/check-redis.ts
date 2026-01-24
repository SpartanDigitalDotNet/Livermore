import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('REDIS_URL not set');
  process.exit(1);
}
console.log('Connecting to:', redisUrl);
const redis = new Redis(redisUrl);

async function check() {
  // Get ALL keys first
  const allKeys = await redis.keys('*');
  console.log('Total keys in Redis:', allKeys.length);

  // Group by prefix
  const prefixes = new Map<string, number>();
  for (const key of allKeys) {
    const prefix = key.split(':')[0];
    prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
  }

  console.log('\nKeys by prefix:');
  for (const [prefix, count] of prefixes) {
    console.log(`  ${prefix}: ${count}`);
  }

  // Check candles specifically
  const candleKeys = await redis.keys('candles:*');
  console.log('\nCandle keys:', candleKeys.length);
  if (candleKeys.length > 0) {
    console.log('Sample candle keys:');
    candleKeys.slice(0, 5).forEach(k => console.log('  ', k));

    // Check one candle's data
    const sampleKey = candleKeys[0];
    const type = await redis.type(sampleKey);
    console.log(`\nSample key type: ${type}`);
    if (type === 'zset') {
      const count = await redis.zcard(sampleKey);
      console.log(`Candles in ${sampleKey}: ${count}`);
    }
  }

  // Check for indicators
  const indicatorKeys = await redis.keys('indicator*');
  console.log('\nIndicator keys:', indicatorKeys.length);
  if (indicatorKeys.length > 0) {
    indicatorKeys.slice(0, 10).forEach(k => console.log('  ', k));
  }

  await redis.quit();
}

check();
