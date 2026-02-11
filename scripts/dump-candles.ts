import Redis from 'ioredis';

const redis = new Redis(process.env.LIVERMORE_REDIS_URL!);

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
