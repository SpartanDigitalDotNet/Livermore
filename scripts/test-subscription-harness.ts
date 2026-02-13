/**
 * Subscription Test Harness - Validates Binance data pipeline end-to-end
 *
 * Tests:
 * TST-01: REST candle fetching with Redis caching (exchange-scoped keys)
 * TST-02: WebSocket live streaming (kline messages)
 *
 * Usage: npx tsx scripts/test-subscription-harness.ts [exchange_name]
 * Example: npx tsx scripts/test-subscription-harness.ts binance_us
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { exchanges } from '../packages/database/drizzle/schema';
import { BinanceRestClient } from '@livermore/binance-client';
import { getRedisClient, exchangeCandleKey } from '@livermore/cache';
import { CandleCacheStrategy } from '@livermore/cache/strategies/candle-cache';
import WebSocket from 'ws';

// Test results tracking
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  message: string;
  details?: any;
}

const results: TestResult[] = [];

function logTest(name: string, status: 'PASS' | 'FAIL', message: string, details?: any) {
  results.push({ name, status, message, details });
  const emoji = status === 'PASS' ? '✓' : '✗';
  console.log(`${emoji} ${name}: ${message}`);
  if (details) {
    console.log('  Details:', JSON.stringify(details, null, 2));
  }
}

async function main() {
  console.log('\n=== Livermore Subscription Test Harness ===\n');

  // Get exchange name from args (default: binance_us)
  const exchangeName = process.argv[2] || 'binance_us';
  console.log(`Target Exchange: ${exchangeName}\n`);

  // Connect to database
  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT;
  const username = process.env.DATABASE_LIVERMORE_USERNAME;
  const password = process.env.DATABASE_LIVERMORE_PASSWORD;
  const database = process.env.LIVERMORE_DATABASE_NAME;

  if (!host || !port || !username || !password || !database) {
    console.error('✗ Missing required DATABASE_* environment variables');
    process.exit(1);
  }

  const connectionString = `postgresql://${username}:${password}@${host}:${port}/${database}?sslmode=require`;
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  try {
    // Look up exchange from database
    console.log('Looking up exchange from database...');
    const [exchange] = await db.select().from(exchanges).where(eq(exchanges.name, exchangeName));

    if (!exchange) {
      console.error(`✗ Exchange "${exchangeName}" not found in database`);
      await pool.end();
      process.exit(1);
    }

    console.log(`✓ Found exchange: ${exchange.displayName} (ID: ${exchange.id})`);
    console.log(`  REST URL: ${exchange.restUrl}`);
    console.log(`  WS URL: ${exchange.wsUrl}\n`);

    // ============================================
    // TEST 1: REST Warmup (TST-01)
    // ============================================
    console.log('--- TEST 1: REST Warmup (TST-01) ---\n');

    try {
      // Create REST client
      const restClient = new BinanceRestClient({ baseUrl: exchange.restUrl });
      console.log('Created BinanceRestClient');

      // Fetch BTC candles (Binance uses BTCUSDT format)
      console.log('Fetching BTC 1d candles from REST API...');
      const candles = await restClient.getCandles('BTCUSDT', '1d');

      if (candles.length === 0) {
        logTest('TST-01: REST Fetch', 'FAIL', 'No candles returned from REST API');
      } else {
        console.log(`✓ Fetched ${candles.length} candles from REST`);
        const newest = candles[candles.length - 1];
        console.log(`  Newest candle: ${new Date(newest.timestamp).toISOString()} - Close: ${newest.close}`);

        // Connect to Redis
        console.log('Connecting to Redis...');
        const redis = getRedisClient();
        console.log('✓ Connected to Redis');

        // Write candles to Redis (userId=1 for shared tier)
        console.log('Writing candles to Redis (Tier 1 - exchange-scoped)...');
        const cacheStrategy = new CandleCacheStrategy(redis);
        await cacheStrategy.addCandles(1, exchange.id, candles, 1);
        console.log('✓ Candles written to cache');

        // Verify candles in Redis
        const cacheKey = exchangeCandleKey(exchange.id, 'BTCUSDT', '1d');
        const cachedCount = await redis.zcard(cacheKey);
        console.log(`✓ Verified Redis cache: ${cachedCount} candles at key ${cacheKey}`);

        if (cachedCount > 0) {
          logTest('TST-01: REST Fetch', 'PASS', `Fetched ${candles.length} candles, cached ${cachedCount}`, {
            restCandles: candles.length,
            cachedCandles: cachedCount,
            cacheKey,
            newestTimestamp: newest.timestamp,
            newestClose: newest.close,
          });
        } else {
          logTest('TST-01: REST Fetch', 'FAIL', 'Candles fetched but not found in Redis cache');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logTest('TST-01: REST Fetch', 'FAIL', `Error: ${message}`);
      console.error('TST-01 Error:', error);
    }

    // ============================================
    // TEST 2: WebSocket Streaming (TST-02)
    // ============================================
    console.log('\n--- TEST 2: WebSocket Streaming (TST-02) ---\n');

    try {
      await new Promise<void>((resolve, reject) => {
        if (!exchange.wsUrl) {
          logTest('TST-02: WebSocket', 'FAIL', 'No WebSocket URL configured for exchange');
          resolve();
          return;
        }

        const wsUrl = `${exchange.wsUrl}/ws`;
        console.log(`Connecting to WebSocket: ${wsUrl}`);

        const ws = new WebSocket(wsUrl);
        let messageCount = 0;
        let klineReceived = false;
        let testTimeout: NodeJS.Timeout;

        ws.on('open', () => {
          console.log('✓ WebSocket connected');

          // Subscribe to BTC 1m klines
          const subscribeMsg = {
            method: 'SUBSCRIBE',
            params: ['btcusdt@kline_1m'],
            id: 1,
          };
          ws.send(JSON.stringify(subscribeMsg));
          console.log('✓ Sent SUBSCRIBE for btcusdt@kline_1m');

          // Run for 2 seconds
          testTimeout = setTimeout(() => {
            console.log(`Closing WebSocket after 2s test (received ${messageCount} messages)`);
            ws.close();
          }, 2000);
        });

        ws.on('message', (data: Buffer) => {
          messageCount++;

          try {
            const msg = JSON.parse(data.toString());

            // Check for kline event
            if (msg.e === 'kline' && msg.k) {
              klineReceived = true;
              const kline = msg.k;
              console.log('✓ Received kline message:', {
                symbol: kline.s,
                interval: kline.i,
                open: kline.o,
                high: kline.h,
                low: kline.l,
                close: kline.c,
                volume: kline.v,
                isFinal: kline.x,
              });
            } else if (msg.result === null && msg.id === 1) {
              console.log('✓ Subscription confirmed');
            }
          } catch (err) {
            console.error('Error parsing WebSocket message:', err);
          }
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          clearTimeout(testTimeout);
          logTest('TST-02: WebSocket', 'FAIL', `WebSocket error: ${error.message}`);
          reject(error);
        });

        ws.on('close', () => {
          console.log('WebSocket closed');
          clearTimeout(testTimeout);

          if (klineReceived) {
            logTest('TST-02: WebSocket', 'PASS', `Received ${messageCount} messages including kline data`, {
              totalMessages: messageCount,
              klineReceived: true,
            });
          } else {
            logTest('TST-02: WebSocket', 'FAIL', `No kline messages received (${messageCount} total messages)`);
          }

          resolve();
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logTest('TST-02: WebSocket', 'FAIL', `Error: ${message}`);
      console.error('TST-02 Error:', error);
    }

    // ============================================
    // Print Summary
    // ============================================
    console.log('\n=== Test Summary ===\n');

    const passed = results.filter((r) => r.status === 'PASS').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;

    for (const result of results) {
      const emoji = result.status === 'PASS' ? '✓' : '✗';
      console.log(`${emoji} ${result.name}: ${result.status}`);
      if (result.status === 'FAIL') {
        console.log(`  ${result.message}`);
      }
    }

    console.log(`\nTotal: ${passed} passed, ${failed} failed\n`);

    // Cleanup
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Fatal error:', error);
    await pool.end();
    process.exit(1);
  }
}

main();
