import { getRedisClient } from '@livermore/cache';

async function main() {
  try {
    const redis = getRedisClient();
    console.log('Connected to Redis');

    const count = await redis.zcard('candles:1:1:BTC-USD:1d');
    console.log('Total 1d candles:', count);

    const candles = await redis.zrange('candles:1:1:BTC-USD:1d', -10, -1);
    console.log('\n=== Last 10 BTC-USD 1d Candles ===\n');

    for (const candleJson of candles) {
      const candle = JSON.parse(candleJson);
      console.log(JSON.stringify(candle));
    }

    await redis.quit();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
