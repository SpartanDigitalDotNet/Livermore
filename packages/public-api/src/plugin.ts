import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import { candlesRoute, exchangesRoute, symbolsRoute } from './routes/index.js';

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
export const publicApiPlugin: FastifyPluginAsyncZod = async (instance) => {
  // Register Zod type provider compilers for validation and serialization
  instance.setValidatorCompiler(validatorCompiler);
  instance.setSerializerCompiler(serializerCompiler);

  // Register OpenAPI 3.1 spec generator
  await instance.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Livermore Public API',
        version: '1.0.0',
        description: `
**Livermore Public API** provides high-quality cryptocurrency market data including OHLCV candles, exchange metadata, and trading pair information.

This API is designed for programmatic access by:
- **Algorithmic trading bots** requiring real-time price feeds
- **Portfolio trackers** aggregating multi-exchange balances
- **AI agents** executing autonomous trading strategies
- **Market analytics tools** performing technical analysis
- **Charting applications** visualizing price action

**Data sources:** All candle data is sourced from live exchange WebSocket feeds and cached for low-latency access. Exchange status reflects real-time connection health. Symbol metadata includes liquidity grading derived from 24-hour trading volume and order book depth.

**Pagination:** All list endpoints support cursor-based pagination for efficient iteration through large result sets. Use the \`next_cursor\` value from the response metadata as the \`cursor\` query parameter for the next page.

**Response format:** All successful responses use a JSON envelope with \`success: true\`, \`data\` array, and \`meta\` pagination object. Error responses use \`success: false\` with standardized error codes.

**Rate limits:** (To be implemented in Phase 41 - API Authentication & Rate Limiting)

**Authentication:** (To be implemented in Phase 41 - API Key infrastructure)
        `.trim(),
      },
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
      ],
    },
  });

  // Register Swagger UI for interactive API documentation
  await instance.register(fastifySwaggerUi, {
    routePrefix: '/docs',
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

  // OpenAPI spec endpoint
  typedInstance.get('/openapi.json', {
    schema: {
      hide: true, // Don't include this endpoint in the OpenAPI spec itself
    },
  }, async (_request, reply) => {
    return reply.send(instance.swagger());
  });

  // Sanitized error handler for this plugin scope
  // Strips stack traces, internal field names, and implementation details
  instance.setErrorHandler((error: Error, request, reply) => {
    // Log full error server-side (includes stack trace)
    request.log.error(error);

    // Determine status code
    const statusCode = (error as any).statusCode ?? 500;
    let errorCode = 'INTERNAL_ERROR';
    let message = 'An internal error occurred';

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      const code = 400;
      errorCode = 'BAD_REQUEST';
      message = 'Invalid request parameters';

      // Extract field-level errors (public field names only, no schema internals)
      const fieldErrors = error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      return reply.code(code).send({
        success: false,
        error: {
          code: errorCode,
          message,
          details: fieldErrors,
        },
      });
    }

    // Handle Fastify validation errors
    if ((error as any).validation) {
      errorCode = 'BAD_REQUEST';
      message = 'Invalid request parameters';
    }

    // Map HTTP status codes to error codes
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

    // NEVER expose stack traces or internal field names in production
    // Return sanitized error envelope
    return reply.code(statusCode).send({
      success: false,
      error: {
        code: errorCode,
        message,
      },
    });
  });
};
