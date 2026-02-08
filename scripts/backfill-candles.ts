/**
 * Backfill candles for all symbols across all timeframes
 * Run with: npx tsx scripts/backfill-candles.ts
 */
import Redis from 'ioredis';
import { CoinbaseRestClient } from '@livermore/coinbase-client';
import { CandleCacheStrategy } from '@livermore/cache';
import type { Timeframe } from '@livermore/schemas';

const redis = new Redis(process.env.LIVERMORE_REDIS_URL!);
const candleCache = new CandleCacheStrategy(redis);

// Get credentials from environment
const apiKeyId = process.env.Coinbase_ApiKeyId;
const privateKeyPem = process.env.Coinbase_EcPrivateKeyPem;

if (!apiKeyId || !privateKeyPem) {
  console.error('Missing Coinbase credentials in environment');
  process.exit(1);
}

const restClient = new CoinbaseRestClient(apiKeyId, privateKeyPem);

const SYMBOLS = [
  'BTC-USD', 'ETH-USD', 'XRP-USD', 'LINK-USD', 'BONK-USD',
  'ONDO-USD', 'PENGU-USD', 'WLD-USD', 'TOSHI-USD', 'SYRUP-USD',
  'GFI-USD', 'DIA-USD', 'NEON-USD', 'DIMO-USD', 'SKL-USD',
  'MATH-USD', 'CTX-USD', 'SPK-USD', 'OMNI-USD', 'METIS-USD',
  'LRDS-USD', 'ASM-USD', 'NOICE-USD', 'LCX-USD', 'SD-USD'
];

// Timeframes to backfill (excluding 1m - that comes from market_trades)
const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

const USER_ID = 1;
const EXCHANGE_ID = 1;

async function backfillSymbol(symbol: string, timeframe: Timeframe): Promise<number> {
  try {
    const candles = await restClient.getCandles(symbol, timeframe);

    if (candles.length === 0) {
      console.log(`  ${symbol} ${timeframe}: No candles returned`);
      return 0;
    }

    // Take up to 100 candles
    const toCache = candles.slice(0, 100);

    await candleCache.addCandles(USER_ID, EXCHANGE_ID, toCache);

    return toCache.length;
  } catch (error) {
    console.error(`  ${symbol} ${timeframe}: Error - ${error instanceof Error ? error.message : error}`);
    return 0;
  }
}

async function main() {
  console.log('Starting candle backfill...');
  console.log(`Symbols: ${SYMBOLS.length}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log('');

  let totalCandles = 0;
  let completed = 0;
  const total = SYMBOLS.length * TIMEFRAMES.length;

  for (const timeframe of TIMEFRAMES) {
    console.log(`\n=== ${timeframe} ===`);

    for (const symbol of SYMBOLS) {
      const count = await backfillSymbol(symbol, timeframe);
      totalCandles += count;
      completed++;

      if (count > 0) {
        console.log(`  ${symbol}: ${count} candles`);
      }

      // Rate limit: 100ms between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`Progress: ${completed}/${total} (${((completed/total)*100).toFixed(1)}%)`);
  }

  console.log(`\n\nBackfill complete!`);
  console.log(`Total candles cached: ${totalCandles}`);

  await redis.quit();
}

main().catch(err => {
  console.error('Backfill failed:', err);
  redis.quit();
  process.exit(1);
});
