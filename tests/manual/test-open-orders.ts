/**
 * Test Coinbase open orders API and cache to Redis
 *
 * Run with: powershell -ExecutionPolicy Bypass -File scripts/run-test-open-orders.ps1
 * Requires:
 *   - Coinbase_ApiKeyId and Coinbase_EcPrivateKeyPem env vars
 *   - Redis running on REDIS_URL (default: redis://127.0.0.1:6400)
 *
 * Redis key: orders:open:{userId}:{exchangeId}
 * Use Redis CLI to inspect:
 *   redis-cli -p 6400
 *   HGETALL orders:open:1:1
 */
import { CoinbaseRestClient, type CoinbaseOrder } from '@livermore/coinbase-client';
import Redis from 'ioredis';

// Hardcoded for test - in production these come from database
const TEST_USER_ID = 1;
const TEST_EXCHANGE_ID = 1;

const apiKeyId = process.env.Coinbase_ApiKeyId;
const privateKey = process.env.Coinbase_EcPrivateKeyPem?.replace(/\\n/g, '\n');

if (!apiKeyId || !privateKey) {
  console.error('Missing Coinbase credentials in environment');
  console.error('Set Coinbase_ApiKeyId and Coinbase_EcPrivateKeyPem');
  process.exit(1);
}

const client = new CoinbaseRestClient(apiKeyId, privateKey);

/**
 * Extract size and price from order configuration
 */
function getOrderDetails(order: CoinbaseOrder) {
  let size: string | undefined;
  let limitPrice: string | undefined;
  let stopPrice: string | undefined;

  const config = order.order_configuration;
  if (config.limit_limit_gtc) {
    size = config.limit_limit_gtc.base_size;
    limitPrice = config.limit_limit_gtc.limit_price;
  } else if (config.limit_limit_gtd) {
    size = config.limit_limit_gtd.base_size;
    limitPrice = config.limit_limit_gtd.limit_price;
  } else if (config.stop_limit_stop_limit_gtc) {
    size = config.stop_limit_stop_limit_gtc.base_size;
    limitPrice = config.stop_limit_stop_limit_gtc.limit_price;
    stopPrice = config.stop_limit_stop_limit_gtc.stop_price;
  } else if (config.stop_limit_stop_limit_gtd) {
    size = config.stop_limit_stop_limit_gtd.base_size;
    limitPrice = config.stop_limit_stop_limit_gtd.limit_price;
    stopPrice = config.stop_limit_stop_limit_gtd.stop_price;
  } else if (config.market_market_ioc) {
    size = config.market_market_ioc.base_size || config.market_market_ioc.quote_size;
  }

  return { size, limitPrice, stopPrice };
}

/**
 * Format number with commas
 */
function formatNumber(num: number | string, decimals = 2): string {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return 'N/A';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Calculate estimated fee for an order
 */
function calculateFee(size: string | undefined, price: string | undefined, feeRate: number): number {
  if (!size || !price) return 0;
  const orderValue = parseFloat(size) * parseFloat(price);
  return orderValue * feeRate;
}

async function main() {
  console.log('Fetching open orders and fees from Coinbase...\n');

  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6400';
  let redis: Redis | null = null;
  let redisAvailable = false;
  const redisKey = `orders:open:${TEST_USER_ID}:${TEST_EXCHANGE_ID}`;

  // Try to connect to Redis (optional)
  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      connectTimeout: 2000,
    });
    await redis.ping();
    redisAvailable = true;
    console.log('Redis connected\n');
  } catch {
    console.log('Redis not available (will skip caching)\n');
    redis = null;
  }

  try {
    // Fetch fee tier first
    console.log('Fetching fee tier...');
    const summary = await client.getTransactionSummary();
    const makerRate = parseFloat(summary.fee_tier.maker_fee_rate);
    const takerRate = parseFloat(summary.fee_tier.taker_fee_rate);

    console.log('\n=== FEE TIER ===');
    console.log(`Tier: ${summary.fee_tier.pricing_tier}`);
    console.log(`30-Day Volume: $${formatNumber(summary.advanced_trade_only_volume)}`);
    console.log(`Maker Fee: ${(makerRate * 100).toFixed(2)}%`);
    console.log(`Taker Fee: ${(takerRate * 100).toFixed(2)}%`);
    console.log('');

    // Fetch open orders
    console.log('Fetching open orders...');
    const orders = await client.getOpenOrders();

    console.log(`\n=== OPEN ORDERS (${orders.length}) ===\n`);

    if (orders.length === 0) {
      console.log('No open orders found.');
      console.log('(Place a limit order on Coinbase to test)');

      if (redis && redisAvailable) {
        await redis.del(redisKey);
      }
    } else {
      // Print table header
      console.log('| Symbol      | Side | Type  | Limit Price | Size           | Est. Value    | Est. Fee (Maker) |');
      console.log('|-------------|------|-------|-------------|----------------|---------------|------------------|');

      let totalValue = 0;
      let totalFee = 0;

      for (const order of orders) {
        const { size, limitPrice, stopPrice } = getOrderDetails(order);

        // Calculate estimated value and fee
        const orderValue = size && limitPrice ? parseFloat(size) * parseFloat(limitPrice) : 0;
        const estFee = calculateFee(size, limitPrice, makerRate); // Limit orders are maker

        totalValue += orderValue;
        totalFee += estFee;

        // Format for display
        const symbol = order.product_id.padEnd(11);
        const side = order.side.padEnd(4);
        const type = order.order_type.padEnd(5);
        const priceStr = limitPrice ? `$${formatNumber(limitPrice, 6)}`.padEnd(11) : 'N/A'.padEnd(11);
        const sizeStr = size ? formatNumber(parseFloat(size), 2).padEnd(14) : 'N/A'.padEnd(14);
        const valueStr = `$${formatNumber(orderValue)}`.padEnd(13);
        const feeStr = `$${formatNumber(estFee)}`.padEnd(16);

        console.log(`| ${symbol} | ${side} | ${type} | ${priceStr} | ${sizeStr} | ${valueStr} | ${feeStr} |`);

        // Store in Redis if available
        if (redis && redisAvailable) {
          if (orders.indexOf(order) === 0) {
            await redis.del(redisKey);
          }
          await redis.hset(redisKey, order.order_id, JSON.stringify({
            orderId: order.order_id,
            symbol: order.product_id,
            side: order.side,
            type: order.order_type,
            status: order.status,
            size,
            limitPrice,
            stopPrice,
            estValue: orderValue,
            estFee,
            createdAt: order.created_time,
          }));
        }
      }

      console.log('|-------------|------|-------|-------------|----------------|---------------|------------------|');
      console.log(`| TOTAL       |      |       |             |                | $${formatNumber(totalValue).padEnd(12)} | $${formatNumber(totalFee).padEnd(15)} |`);
      console.log('');

      // Store metadata
      if (redis && redisAvailable) {
        await redis.hset(redisKey, '_meta', JSON.stringify({
          lastSync: new Date().toISOString(),
          count: orders.length,
          totalValue,
          totalFee,
          makerRate,
          takerRate,
        }));

        console.log(`Cached ${orders.length} orders to Redis`);
        console.log(`Key: ${redisKey}`);
        console.log('\nInspect with:');
        console.log(`  redis-cli -p 6400 HGETALL "${redisKey}"`);
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (redis) {
      await redis.quit();
    }
  }
}

main().catch(console.error);
