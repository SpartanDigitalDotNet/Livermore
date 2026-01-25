import Redis from 'ioredis';
import { CoinbaseRestClient } from '@livermore/coinbase-client';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6400');
const client = new CoinbaseRestClient(
  process.env.Coinbase_ApiKeyId!,
  process.env.Coinbase_EcPrivateKeyPem!
);

async function debug() {
  // Get REST candles
  const restCandles = await client.getCandles('BTC-USD', '1m');
  console.log('REST candles returned:', restCandles.length);
  console.log('\nREST candle [0] (newest):');
  console.log(JSON.stringify(restCandles[0], null, 2));
  console.log('\nREST candle [0] fields:');
  console.log('  timestamp:', restCandles[0].timestamp, '=', new Date(restCandles[0].timestamp).toISOString());
  console.log('  open:', restCandles[0].open);
  console.log('  high:', restCandles[0].high);
  console.log('  low:', restCandles[0].low);
  console.log('  close:', restCandles[0].close);
  console.log('  H-L:', restCandles[0].high - restCandles[0].low);

  // Get cache candle with same timestamp
  const targetTs = restCandles[0].timestamp;
  const cacheCandles = await redis.zrangebyscore(
    'candles:1:1:BTC-USD:1m',
    targetTs,
    targetTs
  );

  if (cacheCandles.length > 0) {
    const cached = JSON.parse(cacheCandles[0]);
    console.log('\nCache candle at same timestamp:');
    console.log(JSON.stringify(cached, null, 2));
    console.log('\nCache candle fields:');
    console.log('  timestamp:', cached.timestamp, '=', new Date(cached.timestamp).toISOString());
    console.log('  open:', cached.open);
    console.log('  high:', cached.high);
    console.log('  low:', cached.low);
    console.log('  close:', cached.close);
    console.log('  H-L:', cached.high - cached.low);

    console.log('\nDIFFERENCE:');
    console.log('  REST H-L:', (restCandles[0].high - restCandles[0].low).toFixed(2));
    console.log('  Cache H-L:', (cached.high - cached.low).toFixed(2));
  } else {
    console.log('\nNo cache candle found at timestamp', targetTs);
  }

  await redis.quit();
}

debug().catch(console.error);
