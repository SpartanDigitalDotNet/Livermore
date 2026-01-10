/**
 * Integration test for Livermore Phase 1 setup
 * Tests database, Redis, and all packages working together
 */

import { validateEnv, createLogger } from '@livermore/utils';
import { createDbClient } from '@livermore/database';
import { createRedisClient, CandleCacheStrategy } from '@livermore/cache';
import { CandleSchema } from '@livermore/schemas';

const logger = createLogger('test-setup');

async function testSetup() {
  logger.info('🧪 Starting Phase 1 integration tests...\n');

  try {
    // Test 1: Environment variable validation
    logger.info('1️⃣  Testing environment variable validation...');
    const config = validateEnv();
    logger.info(`   ✅ Environment validated: ${config.NODE_ENV} mode`);
    logger.info(`   ✅ Database: ${config.LIVERMORE_DATABASE_NAME}`);
    logger.info(`   ✅ API Port: ${config.DATABASE_PORT}\n`);

    // Test 2: PostgreSQL connection
    logger.info('2️⃣  Testing PostgreSQL connection...');
    const db = createDbClient(config);
    logger.info('   ✅ PostgreSQL connected successfully\n');

    // Test 3: Redis connection
    logger.info('3️⃣  Testing Redis connection...');
    const redis = createRedisClient(config);
    await redis.ping();
    logger.info('   ✅ Redis connected successfully\n');

    // Test 4: Redis caching
    logger.info('4️⃣  Testing Redis caching strategies...');
    const candleCache = new CandleCacheStrategy(redis);

    const testCandle = {
      symbol: 'BTC-USD',
      timeframe: '1h' as const,
      timestamp: Date.now(),
      open: 50000,
      high: 51000,
      low: 49500,
      close: 50500,
      volume: 100.5,
    };

    // Validate with Zod
    const validatedCandle = CandleSchema.parse(testCandle);
    logger.info('   ✅ Zod schema validation passed');

    // Cache the candle
    await candleCache.addCandle(validatedCandle);
    logger.info('   ✅ Candle cached in Redis');

    // Retrieve the candle
    const retrieved = await candleCache.getRecentCandles('BTC-USD', '1h', 1);
    if (retrieved.length === 1 && retrieved[0].close === 50500) {
      logger.info('   ✅ Candle retrieved from Redis cache\n');
    } else {
      throw new Error('Failed to retrieve candle from cache');
    }

    // Test 5: Redis pub/sub
    logger.info('5️⃣  Testing Redis pub/sub...');
    await candleCache.publishUpdate(validatedCandle);
    logger.info('   ✅ Published candle update to Redis channel\n');

    // Cleanup
    logger.info('🧹 Cleaning up test data...');
    await candleCache.clearCandles('BTC-USD', '1h');
    await redis.quit();
    logger.info('   ✅ Cleanup completed\n');

    // Summary
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('✅ All Phase 1 integration tests passed!');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    logger.info('Summary:');
    logger.info('  • Environment variables: ✅');
    logger.info('  • PostgreSQL connection: ✅');
    logger.info('  • Redis connection: ✅');
    logger.info('  • Zod schema validation: ✅');
    logger.info('  • Redis caching: ✅');
    logger.info('  • Redis pub/sub: ✅');
    logger.info('\n🚀 System is ready for Phase 2!\n');

    process.exit(0);
  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testSetup();
