import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6400');

async function check() {
  const timeframes = ['1m', '5m', '15m', '1h'];
  const price = 89700;

  console.log('BTC-USD ATR by timeframe:');
  console.log('Timeframe | ATR        | ATR %    | MACD-V');
  console.log('-'.repeat(55));

  const atrs: Record<string, number> = {};

  for (const tf of timeframes) {
    const ind = await redis.get(`indicator:1:1:BTC-USD:${tf}:macd-v`);
    if (ind) {
      const data = JSON.parse(ind);
      const atr = data.value.atr;
      const atrPct = (atr / price) * 100;
      const macdv = data.value.macdV;
      atrs[tf] = atr;
      console.log(
        tf.padEnd(9),
        '|',
        atr.toFixed(4).padStart(10),
        '|',
        atrPct.toFixed(4).padStart(7) + '%',
        '|',
        macdv.toFixed(2)
      );
    }
  }

  console.log('\nATR Ratios:');
  if (atrs['5m'] && atrs['1m']) console.log('  5m/1m:', (atrs['5m'] / atrs['1m']).toFixed(2) + 'x');
  if (atrs['15m'] && atrs['5m']) console.log('  15m/5m:', (atrs['15m'] / atrs['5m']).toFixed(2) + 'x');
  if (atrs['1h'] && atrs['15m']) console.log('  1h/15m:', (atrs['1h'] / atrs['15m']).toFixed(2) + 'x');
  if (atrs['1h'] && atrs['1m']) console.log('  1h/1m:', (atrs['1h'] / atrs['1m']).toFixed(2) + 'x');

  await redis.quit();
}

check().catch(console.error);
