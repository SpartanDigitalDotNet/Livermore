import { validateEnv } from '@livermore/utils';
import { createRedisClient, testRedisConnection } from '@livermore/cache';

async function main() {
  const config = validateEnv();
  const redis = createRedisClient(config);

  console.log('Connecting to Redis...');
  await testRedisConnection(redis);
  console.log('Connected!\n');

  const symbol = process.env.CHECK_SYMBOL || 'BTC-USD';
  const exchangeId = 1;

  // First, find all indicator keys for BTC-USD
  console.log(`=== Indicator keys for ${symbol} ===\n`);
  const scanResult: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `indicator:*:${symbol}:*`, 'COUNT', 100);
    cursor = nextCursor;
    scanResult.push(...keys);
  } while (cursor !== '0');

  if (scanResult.length === 0) {
    console.log('No indicator keys found');
    await redis.quit();
    return;
  }

  for (const k of scanResult.sort()) {
    const type = await redis.type(k);
    console.log(`  ${k} [${type}]`);

    if (type === 'string') {
      const val = await redis.get(k);
      if (val) {
        try {
          const parsed = JSON.parse(val);
          console.log(`    ${JSON.stringify(parsed).substring(0, 200)}`);
        } catch {
          console.log(`    ${val.substring(0, 200)}`);
        }
      }
    } else if (type === 'zset') {
      const count = await redis.zcard(k);
      const latest = await redis.zrange(k, -1, -1, 'WITHSCORES');
      console.log(`    ${count} entries, latest: ${latest[0]?.substring(0, 150)}`);
    } else if (type === 'hash') {
      const all = await redis.hgetall(k);
      console.log(`    ${JSON.stringify(all).substring(0, 200)}`);
    } else if (type === 'list') {
      const len = await redis.llen(k);
      const latest = await redis.lrange(k, -1, -1);
      console.log(`    ${len} entries, latest: ${latest[0]?.substring(0, 150)}`);
    }
  }

  await redis.quit();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
