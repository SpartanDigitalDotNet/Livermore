import { CoinbaseRestClient } from '@livermore/exchange-core';

const client = new CoinbaseRestClient(
  process.env.Coinbase_ApiKeyId!,
  process.env.Coinbase_EcPrivateKeyPem!
);

async function compare() {
  const candles1m = await client.getCandles('BTC-USD', '1m');
  const candles5m = await client.getCandles('BTC-USD', '5m');

  // Get the latest 5m candle
  const latest5m = candles5m[0];
  const start5m = latest5m.timestamp;
  const end5m = start5m + 5 * 60 * 1000;

  console.log('Latest 5m candle from REST:');
  console.log('  Time:', new Date(start5m).toISOString());
  console.log('  O:', latest5m.open.toFixed(2), 'H:', latest5m.high.toFixed(2), 'L:', latest5m.low.toFixed(2), 'C:', latest5m.close.toFixed(2));
  console.log('  H-L:', (latest5m.high - latest5m.low).toFixed(2));

  // Find the 5 1m candles that should make up this 5m candle
  const matching1m = candles1m.filter(c => c.timestamp >= start5m && c.timestamp < end5m);
  matching1m.sort((a, b) => a.timestamp - b.timestamp);

  console.log('\nCorresponding 1m candles from REST:');
  let min1m = Infinity;
  let max1m = -Infinity;

  for (const c of matching1m) {
    const time = new Date(c.timestamp).toISOString().slice(11, 19);
    console.log('  ', time, 'O:', c.open.toFixed(2), 'H:', c.high.toFixed(2), 'L:', c.low.toFixed(2), 'C:', c.close.toFixed(2), 'H-L:', (c.high - c.low).toFixed(2));
    min1m = Math.min(min1m, c.low);
    max1m = Math.max(max1m, c.high);
  }

  console.log('\nComposite from 1m candles:');
  console.log('  Composite H:', max1m.toFixed(2));
  console.log('  Composite L:', min1m.toFixed(2));
  console.log('  Composite H-L:', (max1m - min1m).toFixed(2));

  console.log('\n5m candle H-L:', (latest5m.high - latest5m.low).toFixed(2));
  console.log('Composite 1m H-L:', (max1m - min1m).toFixed(2));

  if (Math.abs((latest5m.high - latest5m.low) - (max1m - min1m)) > 1) {
    console.log('\n*** MISMATCH! 1m candles don\'t add up to 5m candle ***');
  } else {
    console.log('\n1m candles correctly compose into 5m candle');
  }
}

compare().catch(console.error);
