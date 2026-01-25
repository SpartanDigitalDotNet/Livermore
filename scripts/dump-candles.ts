import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6400');

async function dump() {
  const candleKeys = await redis.keys('candles:*');
  candleKeys.sort();

  for (const key of candleKeys) {
    console.log(`\n=== ${key} ===`);
    const candles = await redis.zrange(key, 0, -1);
    for (const raw of candles) {
      const c = JSON.parse(raw);
      const time = new Date(c.timestamp).toISOString();
      const hl = (c.high - c.low).toFixed(6);
      console.log(`${time} O=${c.open} H=${c.high} L=${c.low} C=${c.close} V=${c.volume} H-L=${hl}`);
    }
  }

  await redis.quit();
}

dump().catch(console.error);
