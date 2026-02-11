import Redis, { Cluster } from 'ioredis';
import { HARDCODED_CONFIG, type EnvConfig } from '@livermore/schemas';
import { createLogger, validateEnv } from '@livermore/utils';

const logger = createLogger('redis');

/**
 * Check if hostname is Azure Redis (requires TLS and cluster mode)
 */
function isAzureRedis(host: string): boolean {
  return host.endsWith('.redis.azure.net') || host.endsWith('.redis.cache.windows.net');
}

/**
 * Create a Redis client instance
 *
 * For Azure Redis with OSS Cluster enabled, we use ioredis Cluster mode.
 * For local/non-clustered Redis, we use a regular Redis client.
 *
 * @param config - Validated environment configuration
 * @returns Redis client instance
 */
export function createRedisClient(config: EnvConfig): Redis | Cluster {
  logger.info('Connecting to Redis...');

  // Construct connection from 3 separate env vars (never stored as a full URL)
  const host = config.LIVERMORE_REDIS_URL;
  const port = config.LIVERMORE_REDIS_PORT;
  const password = config.LIVERMORE_REDIS_SECRET;
  const useTls = isAzureRedis(host);

  logger.info(`Redis target: redis://:<redacted>@${host}:${port}`);

  // Use Cluster mode for Azure Redis (which has OSS Cluster enabled)
  if (isAzureRedis(host)) {
    logger.info(`Using Redis Cluster mode with TLS for ${host}:${port}`);

    const cluster = new Cluster(
      [{ host, port }],
      {
        redisOptions: {
          password,
          tls: { servername: host },
          connectTimeout: 10000,
        },
        scaleReads: 'master',
        maxRedirections: 16,
        retryDelayOnMoved: 100,
        retryDelayOnClusterDown: 300,
        clusterRetryStrategy: (times) => {
          if (times > HARDCODED_CONFIG.redis.maxRetries) {
            logger.error('Redis Cluster max retries reached');
            return null;
          }
          const delay = Math.min(times * HARDCODED_CONFIG.redis.retryDelayMs, 5000);
          logger.warn(`Redis Cluster retry attempt ${times}, waiting ${delay}ms`);
          return delay;
        },
        slotsRefreshTimeout: 10000,
        enableReadyCheck: true,
        // Don't use DNS lookup override - let it resolve naturally
      }
    );

    cluster.on('connect', () => {
      logger.info('Redis Cluster client connected');
    });

    cluster.on('ready', () => {
      logger.info('Redis Cluster client ready');
    });

    cluster.on('error', (error) => {
      logger.error({ err: error }, 'Redis Cluster client error');
    });

    cluster.on('close', () => {
      logger.warn('Redis Cluster connection closed');
    });

    return cluster;
  }

  // Regular Redis client for local development
  if (useTls) {
    logger.info(`Using Redis with TLS for ${host}:${port}`);
  } else {
    logger.info(`Using Redis (no TLS) for ${host}:${port}`);
  }

  const redis = new Redis({
    host,
    port,
    password,
    tls: useTls ? { servername: host } : undefined,
    maxRetriesPerRequest: HARDCODED_CONFIG.redis.maxRetries,
    retryStrategy: (times) => {
      if (times > HARDCODED_CONFIG.redis.maxRetries) {
        logger.error('Redis max retries reached');
        return null;
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
export function createRedisPubSubClient(config: EnvConfig): Redis | Cluster {
  const redis = createRedisClient(config);
  logger.info('Redis pub/sub client created');
  return redis;
}

/**
 * Helper type for Redis client (can be regular Redis or Cluster)
 */
export type RedisClient = Redis | Cluster;

/**
 * Test Redis connection with PING command
 * Throws an error if connection fails
 */
export async function testRedisConnection(redis: Redis | Cluster): Promise<void> {
  try {
    const result = await redis.ping();
    if (result !== 'PONG') {
      throw new Error(`Unexpected PING response: ${result}`);
    }
    logger.info('Redis connection test passed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Redis connection test FAILED');
    throw new Error(`Redis connection failed: ${message}`);
  }
}

/**
 * Delete multiple keys safely for Redis Cluster
 *
 * Redis Cluster doesn't allow multi-key DEL when keys hash to different slots.
 * This function deletes keys one at a time to avoid CROSSSLOT errors.
 *
 * @param redis - Redis client instance
 * @param keys - Array of keys to delete
 * @returns Number of keys deleted
 */
export async function deleteKeysClusterSafe(redis: Redis | Cluster, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;

  let deleted = 0;
  for (const key of keys) {
    const result = await redis.del(key);
    deleted += result;
  }
  return deleted;
}

/**
 * Singleton Redis client instance
 */
let redisInstance: Redis | Cluster | null = null;

/**
 * Get or create the Redis client instance
 *
 * Uses singleton pattern to ensure only one connection exists
 */
export function getRedisClient(): Redis | Cluster {
  if (!redisInstance) {
    const config = validateEnv();
    redisInstance = createRedisClient(config);
  }
  return redisInstance;
}
