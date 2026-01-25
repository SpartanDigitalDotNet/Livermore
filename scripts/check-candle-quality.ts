import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6400');

async function check() {
  // Get BTC-USD 1m candles
  const candles1m = await redis.zrange('candles:1:1:BTC-USD:1m', -30, -1);

  console.log('BTC-USD 1m candles (last 30):');
  console.log('Time       | Open      | High      | Low       | Close     | Range');
  console.log('-'.repeat(75));

  let flatCount = 0;
  for (const c of candles1m) {
    const cd = JSON.parse(c);
    const range = cd.high - cd.low;
    const isFlat = range < 0.01; // Essentially flat
    if (isFlat) flatCount++;

    const time = new Date(cd.timestamp).toISOString().slice(11, 19);
    console.log(
      time.padEnd(10),
      '|', cd.open.toFixed(2).padStart(9),
      '|', cd.high.toFixed(2).padStart(9),
      '|', cd.low.toFixed(2).padStart(9),
      '|', cd.close.toFixed(2).padStart(9),
      '|', range.toFixed(2).padStart(7),
      isFlat ? ' FLAT' : ''
    );
  }

  console.log('\nFlat candles (O=H=L=C):', flatCount, '/', candles1m.length);

  // Compare with 5m candles
  const candles5m = await redis.zrange('candles:1:1:BTC-USD:5m', -6, -1);
  console.log('\n\nBTC-USD 5m candles (last 6):');
  console.log('Time       | Open      | High      | Low       | Close     | Range');
  console.log('-'.repeat(75));

  for (const c of candles5m) {
    const cd = JSON.parse(c);
    const range = cd.high - cd.low;
    const time = new Date(cd.timestamp).toISOString().slice(11, 19);
    console.log(
      time.padEnd(10),
      '|', cd.open.toFixed(2).padStart(9),
      '|', cd.high.toFixed(2).padStart(9),
      '|', cd.low.toFixed(2).padStart(9),
      '|', cd.close.toFixed(2).padStart(9),
      '|', range.toFixed(2).padStart(7)
    );
  }

  await redis.quit();
}

check().catch(console.error);
