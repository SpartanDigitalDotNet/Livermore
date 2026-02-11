/**
 * Test Coinbase candles API granularity values
 *
 * Run with: powershell -ExecutionPolicy Bypass -File scripts/run-test-granularity.ps1
 * Requires: Coinbase_ApiKeyId and Coinbase_EcPrivateKeyPem env vars
 */
import { CoinbaseRestClient } from '@livermore/exchange-core';

const apiKeyId = process.env.Coinbase_ApiKeyId;
const privateKey = process.env.Coinbase_EcPrivateKeyPem?.replace(/\\n/g, '\n');

if (!apiKeyId || !privateKey) {
  console.error('Missing Coinbase credentials in environment');
  process.exit(1);
}

const client = new CoinbaseRestClient(apiKeyId, privateKey);

// Test granularity values
const granularities = [
  'ONE_MINUTE',
  'FIVE_MINUTE',
  'FIFTEEN_MINUTE',
  'THIRTY_MINUTE',
  'ONE_HOUR',
  'TWO_HOUR',
  'FOUR_HOUR',
  'SIX_HOUR',
  'ONE_DAY',
];

async function testGranularity(granularity: string): Promise<boolean> {
  const symbol = 'BTC-USD';
  const path = `/api/v3/brokerage/products/${symbol}/candles?granularity=${granularity}&limit=5`;

  try {
    // Access private method via any cast for testing
    const response = await (client as any).request('GET', path);
    const count = response.candles?.length || 0;
    console.log(`OK ${granularity.padEnd(15)} - ${count} candles returned`);
    return true;
  } catch (error: any) {
    console.log(`FAIL ${granularity.padEnd(15)} - ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('Testing Coinbase candles granularity values...\n');

  let passed = 0;
  let failed = 0;

  for (const g of granularities) {
    const success = await testGranularity(g);
    if (success) passed++;
    else failed++;

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
}

main().catch(console.error);
