import Redis from 'ioredis';

const redisUrl = process.env.LIVERMORE_REDIS_URL;
if (!redisUrl) {
  console.error('LIVERMORE_REDIS_URL not set');
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

  // Check BTC-USD 1h candles to verify data
  const btcKey = 'candles:1:1:BTC-USD:1h';
  const btcCandles = await redis.zrange(btcKey, -5, -1, 'WITHSCORES');
  console.log('\nBTC-USD 1h last 5 candles:');
  for (let i = 0; i < btcCandles.length; i += 2) {
    const candle = JSON.parse(btcCandles[i]);
    const score = btcCandles[i + 1];
    console.log(`  ${new Date(candle.timestamp).toISOString()} | O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`);
  }

  // Check when BTC-USD 1h was last updated
  const btcCount = await redis.zcard(btcKey);
  console.log(`\nBTC-USD 1h total candles: ${btcCount}`);

  // Get the latest candle timestamp
  const latest = await redis.zrange(btcKey, -1, -1, 'WITHSCORES');
  if (latest.length >= 2) {
    const latestCandle = JSON.parse(latest[0]);
    const now = Date.now();
    const age = (now - latestCandle.timestamp) / 1000 / 60;
    console.log(`Latest candle age: ${age.toFixed(1)} minutes`);
  }

  await redis.quit();
}

check();
