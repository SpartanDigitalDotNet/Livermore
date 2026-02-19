/**
 * Rate limit configuration factory for the public API.
 * Uses @fastify/rate-limit with Redis backing for distributed rate limiting.
 */

/**
 * Build the rate limit options object for @fastify/rate-limit.
 *
 * @param redis - Redis client (ioredis instance) for distributed counters
 * @returns Options object to pass to fastify.register(rateLimit, ...)
 */
export function getRateLimitConfig(redis: any) {
  return {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request: any) => String((request as any).apiKeyId ?? request.ip),
    redis,
    nameSpace: '{rl}:public:', // Hash tag for Redis Cluster slot compatibility
    skipOnError: true,
    errorResponseBuilder: (_request: any, context: any) => ({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded. Retry after ${context.after}.`,
      },
    }),
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  };
}
