# @livermore/trpc-config

Shared tRPC configuration and utilities for the Livermore trading system.

## Overview

This package provides the base tRPC setup used by the API server:
- Context creation for each request
- Router and procedure builders
- Reusable middleware (logging, auth, etc.)
- Error formatting with Zod validation errors

## Usage

### In the API Server

```typescript
import { router, publicProcedure, createContext } from '@livermore/trpc-config';
import { CandleArraySchema } from '@livermore/schemas';
import { z } from 'zod';

// Create a router
export const marketRouter = router({
  getCandles: publicProcedure
    .input(
      z.object({
        symbol: z.string(),
        timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']),
      })
    )
    .output(CandleArraySchema)
    .query(async ({ input, ctx }) => {
      ctx.logger.info({ symbol: input.symbol }, 'Fetching candles');
      // ... fetch candles logic
      return candles;
    }),
});

// Attach to Fastify
import fastify from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';

const server = fastify();

server.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: {
    router: appRouter,
    createContext,
  },
});
```

### Context

Every tRPC procedure has access to the context:

```typescript
publicProcedure.query(async ({ ctx }) => {
  // Logger with request ID
  ctx.logger.info('Processing request');

  // Request ID for tracing
  console.log(ctx.requestId);

  // Add more context properties as needed
  // (database, cache, services, etc.)
});
```

### Middleware

Use the provided logging middleware or create custom middleware:

```typescript
import { middleware, publicProcedure } from '@livermore/trpc-config';

// Custom middleware example
const authMiddleware = middleware(async ({ ctx, next }) => {
  // Check authentication
  if (!ctx.user) {
    throw new Error('Unauthorized');
  }
  return next();
});

// Use in procedures
const authenticatedProcedure = publicProcedure.use(authMiddleware);
```

## Development

```bash
# Build the package
pnpm build

# Watch mode for development
pnpm dev

# Type checking
pnpm type-check

# Linting
pnpm lint
```
