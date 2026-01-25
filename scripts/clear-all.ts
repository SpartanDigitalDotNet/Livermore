import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6400');

async function clearAll() {
  const candleKeys = await redis.keys('candles:*');
  const indicatorKeys = await redis.keys('indicator:*');

  if (candleKeys.length > 0) {
    await redis.del(...candleKeys);
  }
  console.log('Deleted ' + candleKeys.length + ' candle keys');

  if (indicatorKeys.length > 0) {
    await redis.del(...indicatorKeys);
  }
  console.log('Deleted ' + indicatorKeys.length + ' indicator keys');

  await redis.quit();
}

clearAll().catch(console.error);
