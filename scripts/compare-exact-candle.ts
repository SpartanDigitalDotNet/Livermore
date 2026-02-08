import Redis from 'ioredis';
import { CoinbaseRestClient } from '@livermore/coinbase-client';

const redis = new Redis(process.env.LIVERMORE_REDIS_URL!);
const client = new CoinbaseRestClient(
  process.env.Coinbase_ApiKeyId!,
  process.env.Coinbase_EcPrivateKeyPem!
);

async function compare() {
  // Get REST candles
  const restCandles = await client.getCandles('BTC-USD', '1m');

  // Get cache candles
  const cacheRaw = await redis.zrange('candles:1:1:BTC-USD:1m', 0, -1);
  const cacheCandles = cacheRaw.map(c => JSON.parse(c));

  // Create lookup by timestamp
  const cacheByTs = new Map(cacheCandles.map(c => [c.timestamp, c]));

  // Find timestamps that exist in both
  console.log('Comparing exact timestamps (last 20 overlapping):');
  console.log('');

  let compared = 0;
  for (const rest of restCandles) {
    const cache = cacheByTs.get(rest.timestamp);
    if (cache && compared < 20) {
      const time = new Date(rest.timestamp).toISOString().slice(11, 19);
      const restHL = rest.high - rest.low;
      const cacheHL = cache.high - cache.low;
      const diff = cacheHL - restHL;
      const diffPct = restHL > 0.1 ? ((diff / restHL) * 100).toFixed(0) + '%' : 'N/A';

      console.log(`${time} ts=${rest.timestamp}`);
      console.log(`  REST:  O=${rest.open.toFixed(2)} H=${rest.high.toFixed(2)} L=${rest.low.toFixed(2)} C=${rest.close.toFixed(2)} H-L=${restHL.toFixed(2)}`);
      console.log(`  CACHE: O=${cache.open.toFixed(2)} H=${cache.high.toFixed(2)} L=${cache.low.toFixed(2)} C=${cache.close.toFixed(2)} H-L=${cacheHL.toFixed(2)}`);
      console.log(`  DIFF:  H-L diff=${diff.toFixed(2)} (${diffPct})`);
      console.log('');

      compared++;
    }
  }

  await redis.quit();
}

compare().catch(console.error);
