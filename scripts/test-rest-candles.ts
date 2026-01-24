import { CoinbaseRestClient } from '@livermore/coinbase-client';

const apiKeyId = process.env.Coinbase_ApiKeyId!;
const privateKeyPem = process.env.Coinbase_EcPrivateKeyPem!;

if (!apiKeyId || !privateKeyPem) {
  console.error('Coinbase credentials not set');
  process.exit(1);
}

const client = new CoinbaseRestClient(apiKeyId, privateKeyPem);

async function test() {
  console.log('Fetching BTC-USD 1h candles from REST API...');
  const candles = await client.getCandles('BTC-USD', '1h');

  console.log(`Received ${candles.length} candles`);

  // Coinbase returns newest first - check first 5
  console.log('\nFirst 5 candles (should be newest):');
  const first = candles.slice(0, 5);
  for (const c of first) {
    console.log(`  ${new Date(c.timestamp).toISOString()} | O:${c.open} H:${c.high} L:${c.low} C:${c.close}`);
  }

  console.log('\nLast 5 candles (should be oldest):');
  const last = candles.slice(-5);
  for (const c of last) {
    console.log(`  ${new Date(c.timestamp).toISOString()} | O:${c.open} H:${c.high} L:${c.low} C:${c.close}`);
  }

  const newest = candles[0];
  const now = Date.now();
  const ageMin = (now - newest.timestamp) / 1000 / 60;
  console.log(`\nNewest candle age: ${ageMin.toFixed(1)} minutes`);
}

test().catch(console.error);
