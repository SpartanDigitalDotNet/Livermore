import { validateEnv } from '@livermore/utils';
import { createRedisClient, testRedisConnection, instanceStatusKey, networkActivityStreamKey } from '@livermore/cache';

async function main() {
  const config = validateEnv();
  const redis = createRedisClient(config);

  console.log('Waiting for Redis ready...');
  await testRedisConnection(redis);
  console.log('Connected!\n');

  // Check instance status keys for exchange IDs 1-5
  console.log('=== INSTANCE STATUS KEYS ===');
  for (const id of [1, 2, 3, 4, 5]) {
    const key = instanceStatusKey(id);
    try {
      const val = await redis.get(key);
      const ttl = await redis.ttl(key);
      if (val) {
        console.log(`\n${key} (TTL: ${ttl}s):`);
        console.log(JSON.stringify(JSON.parse(val), null, 2));
      } else {
        console.log(`${key}: not found`);
      }
    } catch (e) {
      console.log(`${key}: error - ${e}`);
    }
  }

  // Check old prototype keys
  console.log('\n=== OLD PROTOTYPE KEYS ===');
  for (const id of [1, 2, 3]) {
    const oldKey = `exchange:status:${id}`;
    try {
      const val = await redis.get(oldKey);
      if (val) {
        console.log(`${oldKey}: ${val}`);
      } else {
        console.log(`${oldKey}: not found`);
      }
    } catch (e) {
      console.log(`${oldKey}: error`);
    }
  }

  // Check activity streams
  console.log('\n=== ACTIVITY STREAMS ===');
  for (const name of ['coinbase', 'binance', 'binanceus']) {
    const streamKey = networkActivityStreamKey(name);
    try {
      const len = await redis.xlen(streamKey);
      console.log(`\n${streamKey}: ${len} entries`);
      if (len > 0) {
        const entries = await redis.xrevrange(streamKey, '+', '-', 'COUNT', 5);
        for (const [id, fields] of entries) {
          const obj: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
          console.log(`  ${id}:`, JSON.stringify(obj));
        }
      }
    } catch (e) {
      console.log(`${streamKey}: error or not found`);
    }
  }

  console.log('\n=== DONE ===');
  await redis.quit();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
