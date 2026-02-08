import Redis from 'ioredis';

const redis = new Redis(process.env.LIVERMORE_REDIS_URL!);

async function check() {
  const keys = await redis.keys('indicator:*');
  console.log('Total indicator keys:', keys.length);

  const by1m = keys.filter(k => k.includes(':1m:'));
  const by5m = keys.filter(k => k.includes(':5m:'));
  const by15m = keys.filter(k => k.includes(':15m:'));
  const by1h = keys.filter(k => k.includes(':1h:'));
  const by4h = keys.filter(k => k.includes(':4h:'));
  const by1d = keys.filter(k => k.includes(':1d:'));

  console.log('\nIndicators by timeframe:');
  console.log('  1m:', by1m.length);
  console.log('  5m:', by5m.length);
  console.log('  15m:', by15m.length);
  console.log('  1h:', by1h.length);
  console.log('  4h:', by4h.length);
  console.log('  1d:', by1d.length);

  // Check BTC-USD 1m specifically
  const btc1m = await redis.get('indicator:1:1:BTC-USD:1m:macd-v');
  if (btc1m) {
    const data = JSON.parse(btc1m);
    console.log('\nBTC-USD 1m indicator:');
    console.log('  MACD-V:', data.value.macdV?.toFixed(2));
    console.log('  Signal:', data.value.signal?.toFixed(2));
    console.log('  Histogram:', data.value.histogram?.toFixed(2));
    console.log('  Timestamp:', new Date(data.timestamp).toISOString());
  } else {
    console.log('\nBTC-USD 1m indicator NOT FOUND');
  }

  if (by1m.length > 0) {
    console.log('\n1m indicator symbols:', by1m.map(k => k.split(':')[3]).join(', '));
  }

  // Check BTC-USD 1m candles
  const btcCandleCount = await redis.zcard('candles:1:1:BTC-USD:1m');
  console.log('\nBTC-USD 1m candle count:', btcCandleCount);

  await redis.quit();
}

check().catch(console.error);
