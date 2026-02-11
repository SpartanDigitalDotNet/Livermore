import { validateEnv } from '@livermore/utils';
import { createRedisClient, testRedisConnection } from '@livermore/cache';
import { CandleSchema } from '@livermore/schemas';

async function main() {
  const config = validateEnv();
  const redis = createRedisClient(config);
  await testRedisConnection(redis);

  const sources = [
    { id: 1, name: 'Coinbase', symbol: 'BTC-USD' },
    { id: 2, name: 'Binance', symbol: 'BTCUSD' },
  ];

  console.log('=== BTC Price Comparison ===\n');

  for (const src of sources) {
    const key = `candles:${src.id}:${src.symbol}:1m`;
    const latest = await redis.zrange(key, -1, -1);

    if (latest.length > 0) {
      const candle = CandleSchema.parse(JSON.parse(latest[0]));
      const age = Math.round((Date.now() - candle.timestamp) / 60000);
      console.log(`${src.name} (${src.symbol}):`);
      console.log(`  Close: $${candle.close.toLocaleString()}`);
      console.log(`  High:  $${candle.high.toLocaleString()}`);
      console.log(`  Low:   $${candle.low.toLocaleString()}`);
      console.log(`  Age:   ${age}m ago`);
      console.log('');
    } else {
      console.log(`${src.name}: No 1m candle data for ${src.symbol}`);
      console.log('');
    }
  }

  // Also check MACD-V for both
  console.log('=== MACD-V Comparison (1h) ===\n');
  for (const src of sources) {
    const key = `indicator:${src.id}:${src.symbol}:1h:macd-v`;
    const val = await redis.get(key);
    if (val) {
      const parsed = JSON.parse(val);
      const v = parsed.value;
      const age = Math.round((Date.now() - parsed.timestamp) / 60000);
      console.log(`${src.name} (${src.symbol}) 1h:`);
      console.log(`  MACD-V: ${v.macdV.toFixed(1)}  Signal: ${v.signal.toFixed(1)}  Hist: ${v.histogram.toFixed(1)}  (${age}m ago)`);
    } else {
      console.log(`${src.name}: No 1h MACD-V for ${src.symbol}`);
    }
  }

  await redis.quit();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
