/// <reference types="@fastify/websocket" />
import type { FastifyPluginAsync } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  ZodTypeProvider,
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { candlesRoute, exchangesRoute, symbolsRoute, signalsRoute, alertsRoute } from './routes/index.js';
import { buildAuthHook, validateApiKey } from './middleware/auth.js';
import { getRateLimitConfig } from './middleware/rate-limit.js';
import { WebSocketBridge, handleClientMessage } from './ws/index.js';

/**
 * Sanitized error handler for the public API scope.
 * Strips stack traces, internal field names, and implementation details.
 * Uses reply.serializer(JSON.stringify) to bypass Zod response serialization.
 */
function publicErrorHandler(
  error: Error,
  request: { log: { error: (e: Error) => void } },
  reply: any
) {
  request.log.error(error);

  // Bypass Zod response serializer for error responses
  reply.serializer(JSON.stringify);
  reply.header('content-type', 'application/json; charset=utf-8');

  // Handle Zod/Fastify schema validation errors (invalid params, query, body)
  if (hasZodFastifySchemaValidationErrors(error)) {
    return reply.code(400).send({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid request parameters',
      },
    });
  }

  // Handle response serialization errors
  if (isResponseSerializationError(error)) {
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred',
      },
    });
  }

  // Determine status code and error code
  const statusCode = (error as any).statusCode ?? 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'An internal error occurred';

  if (statusCode === 404) {
    errorCode = 'NOT_FOUND';
    message = error.message || 'Resource not found';
  } else if (statusCode === 429) {
    errorCode = 'RATE_LIMITED';
    message = 'Rate limit exceeded';
  } else if (statusCode === 401) {
    errorCode = 'UNAUTHORIZED';
    message = 'Authentication required';
  } else if (statusCode === 403) {
    errorCode = 'FORBIDDEN';
    message = 'Insufficient permissions';
  } else if (statusCode >= 400 && statusCode < 500) {
    errorCode = 'BAD_REQUEST';
    message = error.message || 'Bad request';
  }

  return reply.code(statusCode).send({
    success: false,
    error: {
      code: errorCode,
      message,
    },
  });
}

/**
 * Public API Fastify Plugin
 *
 * Registers:
 * - Zod type provider for schema validation and serialization
 * - @fastify/swagger for OpenAPI 3.1 spec generation
 * - @fastify/swagger-ui for interactive API explorer
 * - All public route handlers (candles, exchanges, symbols)
 * - Sanitized error handler (strips stack traces and internal details)
 *
 * This plugin should be registered under the /public/v1 prefix in server.ts.
 */
export const publicApiPlugin: FastifyPluginAsync<{
  redis?: any;
  exchangeId?: number;
  exchangeName?: string;
}> = async (instance, opts) => {
  // Register Zod type provider compilers for validation and serialization
  instance.setValidatorCompiler(validatorCompiler);
  instance.setSerializerCompiler(serializerCompiler);

  // Set error handler BEFORE registering routes so it covers all child scopes
  instance.setErrorHandler(publicErrorHandler as any);

  // Register API key authentication hook (before rate limiting and routes)
  instance.addHook('onRequest', buildAuthHook());

  // Register rate limiting with Redis backing (after auth hook so apiKeyId is available)
  if (opts.redis) {
    const rateLimit = (await import('@fastify/rate-limit')).default;
    await instance.register(rateLimit, getRateLimitConfig(opts.redis));
  }

  // Register OpenAPI 3.1 spec generator with Zod-to-JSON-Schema transform
  await instance.register(fastifySwagger, {
    transform: jsonSchemaTransform,
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Livermore Public API',
        version: '1.0.0',
        description: `
**Livermore Public API** provides high-quality cryptocurrency market data including OHLCV candles, exchange metadata, trading pair information, trade signals, and alert history.

This API is designed for programmatic access by:
- **Algorithmic trading bots** requiring real-time price feeds
- **Portfolio trackers** aggregating multi-exchange balances
- **AI agents** executing autonomous trading strategies
- **Market analytics tools** performing technical analysis
- **Charting applications** visualizing price action

**Data sources:** All candle data is sourced from live exchange WebSocket feeds and cached for low-latency access. Exchange status reflects real-time connection health. Symbol metadata includes liquidity grading derived from 24-hour trading volume and order book depth. Trade signals provide real-time market analysis with generic direction and strength classifications. Alert history records historical signal trigger events.

**Pagination:** All list endpoints support cursor-based pagination for efficient iteration through large result sets. Use the \`next_cursor\` value from the response metadata as the \`cursor\` query parameter for the next page.

**Response format:** All successful responses use a JSON envelope with \`success: true\`, \`data\` array, and \`meta\` pagination object. Error responses use \`success: false\` with standardized error codes.

**Rate limits:** All endpoints are rate-limited to 300 requests per minute per API key. Rate limit headers (\`x-ratelimit-limit\`, \`x-ratelimit-remaining\`, \`x-ratelimit-reset\`) are included in every response. When the limit is exceeded, a 429 response is returned with a \`retry-after\` header.

**Authentication:** All data endpoints require an API key passed via the \`X-API-Key\` header. Obtain a key from the admin dashboard. The Swagger UI and OpenAPI spec are accessible without authentication.
        `.trim(),
      },
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'X-API-Key',
            in: 'header',
            description: 'API key for authentication. Obtain from the admin dashboard.',
          },
        },
      },
      security: [{ apiKey: [] }],
      servers: [
        {
          url: '/public/v1',
          description: 'Public API v1',
        },
      ],
      tags: [
        {
          name: 'Candles',
          description: 'OHLCV candlestick data endpoints',
        },
        {
          name: 'Exchanges',
          description: 'Exchange metadata and status endpoints',
        },
        {
          name: 'Symbols',
          description: 'Trading pair catalog endpoints',
        },
        {
          name: 'Signals',
          description: 'Trade signal endpoints providing generic market analysis indicators with direction and strength classification',
        },
        {
          name: 'Alerts',
          description: 'Historical trade alert endpoints providing a chronological record of signal events',
        },
      ],
    },
  });

  // Register Swagger UI for interactive API documentation
  await instance.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    indexPrefix: '/public/v1',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
  });

  // Create type-safe instance with Zod provider
  const typedInstance = instance.withTypeProvider<ZodTypeProvider>();

  // Register route handlers
  await typedInstance.register(candlesRoute, { prefix: '/candles' });
  await typedInstance.register(exchangesRoute, { prefix: '/exchanges' });
  await typedInstance.register(symbolsRoute, { prefix: '/symbols' });
  await typedInstance.register(signalsRoute, { prefix: '/signals' });
  await typedInstance.register(alertsRoute, { prefix: '/alerts' });

  // WebSocket streaming endpoint (Phase 42)
  if (opts.redis && opts.exchangeId && opts.exchangeName) {
    const bridge = new WebSocketBridge({
      redis: opts.redis,
      exchangeId: opts.exchangeId,
      exchangeName: opts.exchangeName,
    });
    await bridge.start();

    // Store bridge on instance for lifecycle management
    instance.decorate('wsBridge', bridge);

    // Register cleanup on server close
    instance.addHook('onClose', async () => {
      await bridge.stop();
    });

    instance.get('/stream', { websocket: true }, async (socket, request) => {
      // WS-01: API key auth via query parameter
      const apiKey = (request.query as any).apiKey as string | undefined;
      if (!apiKey) {
        socket.close(4001, 'API key required');
        return;
      }

      const keyId = await validateApiKey(apiKey);
      if (keyId === null) {
        socket.close(4001, 'Invalid API key');
        return;
      }

      // WS-06: Per-key connection limit
      if (bridge.getConnectionCount(keyId) >= 5) {
        socket.close(4008, 'Connection limit exceeded');
        return;
      }

      // Register connection with bridge
      const connection = bridge.addClient(socket, keyId);
      if (!connection) {
        socket.close(4008, 'Connection limit exceeded');
        return;
      }

      // CRITICAL: Attach message handler synchronously per @fastify/websocket requirement
      socket.on('message', (data: Buffer | string) => {
        handleClientMessage(bridge, connection, data);
      });

      socket.on('close', () => {
        bridge.removeClient(connection.connectionId);
      });

      socket.on('error', () => {
        bridge.removeClient(connection.connectionId);
      });
    });
  }

  // OpenAPI spec endpoint
  typedInstance.get('/openapi.json', {
    schema: {
      hide: true,
    },
  }, async (_request, reply) => {
    return reply.send(instance.swagger());
  });
};
