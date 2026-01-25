import { CoinbaseRestClient } from '@livermore/coinbase-client';

const client = new CoinbaseRestClient(
  process.env.Coinbase_ApiKeyId!,
  process.env.Coinbase_EcPrivateKeyPem!
);

async function debug() {
  const candles = await client.getCandles('BTC-USD', '1m');

  console.log('BTC-USD 1m candles from REST API (first 30, newest first):');
  console.log('Time     | Open      | High      | Low       | Close     | H-L');
  console.log('-'.repeat(75));

  let flatCount = 0;
  let totalHL = 0;

  for (let i = 0; i < 30; i++) {
    const c = candles[i];
    const hl = c.high - c.low;
    totalHL += hl;
    if (hl < 1) flatCount++;

    const time = new Date(c.timestamp).toISOString().slice(11, 19);
    console.log(
      time,
      '|',
      c.open.toFixed(2).padStart(9),
      '|',
      c.high.toFixed(2).padStart(9),
      '|',
      c.low.toFixed(2).padStart(9),
      '|',
      c.close.toFixed(2).padStart(9),
      '|',
      hl.toFixed(2).padStart(8),
      hl < 1 ? ' FLAT' : ''
    );
  }

  console.log('\nFlat candles (H-L < $1):', flatCount, '/ 30');
  console.log('Average H-L: $' + (totalHL / 30).toFixed(2));
}

debug().catch(console.error);
