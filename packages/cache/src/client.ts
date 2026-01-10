import Redis from 'ioredis';
import { HARDCODED_CONFIG, type EnvConfig } from '@livermore/schemas';
import { createLogger, validateEnv } from '@livermore/utils';

const logger = createLogger('redis');

/**
 * Create a Redis client instance
 *
 * @param config - Validated environment configuration
 * @returns Redis client instance
 */
export function createRedisClient(config: EnvConfig): Redis {
  logger.info('Connecting to Redis...');

  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: HARDCODED_CONFIG.redis.maxRetries,
    retryStrategy: (times) => {
      if (times > HARDCODED_CONFIG.redis.maxRetries) {
        logger.error('Redis max retries reached');
        return null; // Stop retrying
      }
      const delay = Math.min(times * HARDCODED_CONFIG.redis.retryDelayMs, 5000);
      logger.warn(`Redis retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    commandTimeout: HARDCODED_CONFIG.redis.commandTimeoutMs,
  });

  redis.on('connect', () => {
    logger.info('Redis client connected');
  });

  redis.on('ready', () => {
    logger.info('Redis client ready');
  });

  redis.on('error', (error) => {
    logger.error({ err: error }, 'Redis client error');
  });

  redis.on('close', () => {
    logger.warn('Redis connection closed');
  });

  redis.on('reconnecting', () => {
    logger.info('Redis client reconnecting...');
  });

  return redis;
}

/**
 * Create a Redis client for pub/sub
 * Separate client is recommended for pub/sub operations
 *
 * @param config - Validated environment configuration
 * @returns Redis client instance for pub/sub
 */
export function createRedisPubSubClient(config: EnvConfig): Redis {
  const redis = createRedisClient(config);
  logger.info('Redis pub/sub client created');
  return redis;
}

/**
 * Helper type for Redis client
 */
export type RedisClient = Redis;

/**
 * Singleton Redis client instance
 */
let redisInstance: Redis | null = null;

/**
 * Get or create the Redis client instance
 *
 * Uses singleton pattern to ensure only one connection exists
 */
export function getRedisClient(): Redis {
  if (!redisInstance) {
    const config = validateEnv();
    redisInstance = createRedisClient(config);
  }
  return redisInstance;
}
