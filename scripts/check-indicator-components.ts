import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6400');

async function check() {
  const indicator = await redis.get('indicator:1:1:BTC-USD:1m:macd-v');
  if (indicator) {
    const data = JSON.parse(indicator);
    console.log('BTC-USD 1m indicator components:');
    console.log('  MACD-V:', data.value.macdV?.toFixed(4));
    console.log('  Signal:', data.value.signal?.toFixed(4));
    console.log('  Histogram:', data.value.histogram?.toFixed(4));
    console.log('  fastEMA:', data.value.fastEMA?.toFixed(4));
    console.log('  slowEMA:', data.value.slowEMA?.toFixed(4));
    console.log('  ATR:', data.value.atr?.toFixed(4));

    // Manual calculation check
    const macd = data.value.fastEMA - data.value.slowEMA;
    const macdv = (macd / data.value.atr) * 100;
    console.log('\nManual verification:');
    console.log('  MACD (fast-slow):', macd.toFixed(6));
    console.log('  MACD-V (macd/atr*100):', macdv.toFixed(4));

    // If expected is ~174.8 and actual is ~80, ATR might be 2x
    const expectedMacdV = 174.8;
    const impliedAtr = (macd / expectedMacdV) * 100;
    console.log('\nIf expected MACD-V is', expectedMacdV + ':');
    console.log('  Implied ATR would be:', impliedAtr.toFixed(4));
    console.log('  Our ATR is:', data.value.atr?.toFixed(4));
    console.log('  Ratio (our/implied):', (data.value.atr / impliedAtr).toFixed(2) + 'x');
  }

  // Compare with 5m
  const ind5m = await redis.get('indicator:1:1:BTC-USD:5m:macd-v');
  if (ind5m) {
    const data = JSON.parse(ind5m);
    console.log('\n\nBTC-USD 5m for comparison:');
    console.log('  MACD-V:', data.value.macdV?.toFixed(4));
    console.log('  ATR:', data.value.atr?.toFixed(4));
  }

  await redis.quit();
}

check().catch(console.error);
