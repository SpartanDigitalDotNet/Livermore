import Redis from 'ioredis';
import { CoinbaseRestClient } from '@livermore/exchange-core';

const redis = new Redis(process.env.LIVERMORE_REDIS_URL!);

const apiKeyId = process.env.Coinbase_ApiKeyId!;
const privateKeyPem = process.env.Coinbase_EcPrivateKeyPem!;

async function compare() {
  const client = new CoinbaseRestClient(apiKeyId, privateKeyPem);

  // Get REST candles (newest first)
  console.log('Fetching BTC-USD 1m candles from REST API...');
  const restCandles = await client.getCandles('BTC-USD', '1m');
  console.log('Got', restCandles.length, 'candles from REST');

  // Get cached candles
  const cacheCandles = await redis.zrange('candles:1:1:BTC-USD:1m', 0, -1);
  const parsedCache = cacheCandles.map(c => JSON.parse(c));
  console.log('Got', parsedCache.length, 'candles from cache');

  // Create maps by timestamp for comparison
  const restMap = new Map(restCandles.map(c => [c.timestamp, c]));
  const cacheMap = new Map(parsedCache.map(c => [c.timestamp, c]));

  // Find overlapping timestamps
  const overlap: number[] = [];
  for (const ts of restMap.keys()) {
    if (cacheMap.has(ts)) overlap.push(ts);
  }
  overlap.sort((a, b) => a - b);

  console.log('\nOverlapping candles:', overlap.length);
  console.log('\nComparing last 20 overlapping candles:');
  console.log('Time     | REST H-L | Cache H-L | Diff   | REST Close | Cache Close');
  console.log('-'.repeat(80));

  let totalDiff = 0;
  let significantDiffs = 0;

  const lastOverlap = overlap.slice(-20);
  for (const ts of lastOverlap) {
    const rest = restMap.get(ts)!;
    const cache = cacheMap.get(ts)!;

    const restRange = rest.high - rest.low;
    const cacheRange = cache.high - cache.low;
    const diff = cacheRange - restRange;
    const diffPct = restRange > 0 ? (diff / restRange) * 100 : 0;

    if (Math.abs(diffPct) > 10) significantDiffs++;
    totalDiff += Math.abs(diff);

    const time = new Date(ts).toISOString().slice(11, 19);
    console.log(
      time,
      '|',
      restRange.toFixed(2).padStart(8),
      '|',
      cacheRange.toFixed(2).padStart(9),
      '|',
      (diffPct > 0 ? '+' : '') + diffPct.toFixed(0).padStart(5) + '%',
      '|',
      rest.close.toFixed(2).padStart(10),
      '|',
      cache.close.toFixed(2).padStart(10)
    );
  }

  console.log('\nSignificant differences (>10%):', significantDiffs, '/', lastOverlap.length);
  console.log('Average absolute range diff: $' + (totalDiff / lastOverlap.length).toFixed(2));

  await redis.quit();
}

compare().catch(console.error);
