# Phase 18: Control Channel Foundation - Research

**Researched:** 2026-01-31
**Domain:** Redis pub/sub for command/response communication
**Confidence:** HIGH

## Summary

Phase 18 implements a command/response channel between Admin UI and API using Redis pub/sub. The project already uses ioredis extensively for candle and indicator pub/sub (see `indicator-calculation.service.ts`), so this phase leverages existing patterns. The key challenge is implementing request-reply semantics on top of Redis pub/sub, which is inherently fire-and-forget.

The recommended approach uses two channels per user: one for commands (`livermore:commands:{identity_sub}`) and one for responses (`livermore:responses:{identity_sub}`). Commands include a correlationId for matching responses to requests. ACK is returned immediately, results asynchronously.

**Primary recommendation:** Implement a ControlChannelService class in the API that subscribes to the command channel on startup and publishes ACK/results to the response channel. Use a priority sorted set for command ordering with pause/resume having highest priority.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ioredis | ^5.4.2 | Redis client with pub/sub | Already in project, full TypeScript support |
| zod | ^3.24.1 | Message schema validation | Already used for all schemas in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| uuid | ^9.0.0 | Generate correlationIds | Could use, but `crypto.randomUUID()` is native |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native pub/sub | Redis Streams | Streams have delivery guarantees but more complex; pub/sub sufficient for single-instance |
| BullMQ | Custom implementation | BullMQ overkill for simple command channel; adds dependency |
| Azure Service Bus | Redis pub/sub | Out of scope per REQUIREMENTS.md |

**Installation:**
No new dependencies required. Use existing ioredis and zod.

## Architecture Patterns

### Recommended Project Structure
```
apps/api/src/
├── services/
│   └── control-channel.service.ts   # Command handler, pub/sub management
packages/cache/src/
├── keys.ts                          # Add commandChannel, responseChannel helpers
packages/schemas/src/
├── control/
│   └── command.schema.ts            # Command/response message schemas
```

### Pattern 1: Dual Channel Request-Reply
**What:** Use separate command and response channels per user. Commands flow Admin->API on command channel, responses flow API->Admin on response channel.
**When to use:** Always for this use case - separates concerns, allows multiple subscribers.
**Example:**
```typescript
// Channel naming (add to packages/cache/src/keys.ts)
export function commandChannel(identitySub: string): string {
  return `livermore:commands:${identitySub}`;
}

export function responseChannel(identitySub: string): string {
  return `livermore:responses:${identitySub}`;
}
```

### Pattern 2: Correlation ID for Request-Reply
**What:** Each command includes a unique correlationId. ACK and result messages include the same correlationId for client-side matching.
**When to use:** Always - required for matching responses to requests in async systems.
**Example:**
```typescript
// Command message structure
interface Command {
  correlationId: string;        // UUID for matching response
  type: CommandType;            // 'pause' | 'resume' | 'reload-settings' | etc.
  payload?: Record<string, unknown>;
  timestamp: number;            // For timeout checking
  priority: number;             // Lower = higher priority (1 for pause/resume)
}

// Response message structure
interface CommandResponse {
  correlationId: string;        // Matches command
  status: 'ack' | 'success' | 'error';
  message?: string;
  data?: unknown;
  timestamp: number;
}
```

### Pattern 3: Immediate ACK, Async Result
**What:** Return ACK immediately when command is received (validates receipt). Return result after execution completes.
**When to use:** For commands that may take time to execute (backfill, cache clear).
**Example:**
```typescript
// In command handler
private async handleCommand(command: Command): Promise<void> {
  // Immediate ACK
  await this.publishResponse({
    correlationId: command.correlationId,
    status: 'ack',
    timestamp: Date.now(),
  });

  try {
    // Execute command
    const result = await this.executeCommand(command);

    // Async result
    await this.publishResponse({
      correlationId: command.correlationId,
      status: 'success',
      data: result,
      timestamp: Date.now(),
    });
  } catch (error) {
    await this.publishResponse({
      correlationId: command.correlationId,
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
    });
  }
}
```

### Pattern 4: Priority Queue with Sorted Set
**What:** Use Redis sorted set for command queue instead of direct pub/sub for ordering. Priority as score, process lowest score first.
**When to use:** When command ordering matters (RUN-13: pause/resume before other commands).
**Example:**
```typescript
// Priority levels
const PRIORITY = {
  PAUSE: 1,
  RESUME: 1,
  RELOAD_SETTINGS: 10,
  FORCE_BACKFILL: 20,
  CLEAR_CACHE: 20,
} as const;

// Queue command with priority
async function queueCommand(command: Command): Promise<void> {
  const key = `livermore:command-queue:${identitySub}`;
  await redis.zadd(key, command.priority, JSON.stringify(command));
}

// Process highest priority (lowest score)
async function processNext(): Promise<Command | null> {
  const key = `livermore:command-queue:${identitySub}`;
  const [result] = await redis.zpopmin(key, 1);
  return result ? JSON.parse(result) : null;
}
```

### Pattern 5: Duplicate Redis Client for Subscriber
**What:** Create separate Redis connection for pub/sub subscription using `redis.duplicate()`.
**When to use:** Always when using pub/sub - subscriber connection enters subscriber mode and cannot run other commands.
**Example:**
```typescript
// Source: Existing pattern in indicator-calculation.service.ts
// Create dedicated subscriber (required for pub/sub mode)
this.subscriber = this.redis.duplicate();

// Subscribe to command channel
await this.subscriber.subscribe(commandChannel(identitySub));

// Handle messages
this.subscriber.on('message', (channel: string, message: string) => {
  this.handleCommand(JSON.parse(message)).catch((error) => {
    logger.error({ error, channel }, 'Error handling command');
  });
});

// Cleanup on stop
async stop(): Promise<void> {
  if (this.subscriber) {
    await this.subscriber.unsubscribe();
    await this.subscriber.quit();
    this.subscriber = null;
  }
}
```

### Anti-Patterns to Avoid
- **Using same Redis client for pub/sub and commands:** Once subscribed, connection is in subscriber mode. Use `redis.duplicate()`.
- **Not validating command messages:** Always parse through Zod schema before processing. Malformed messages should be rejected with error response.
- **Blocking execution on command processing:** ACK immediately, process asynchronously. Don't block pub/sub handler.
- **No timeout handling:** Commands must expire after 30s per RUN-12. Check timestamp on receipt.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | Custom random string | `crypto.randomUUID()` | Native, cryptographically secure, RFC compliant |
| Message validation | Manual type checking | Zod schema parse | Type-safe, detailed error messages, consistent with project |
| Redis connection pooling | Manual connection management | ioredis singleton pattern | Already implemented in `@livermore/cache` |
| JSON serialization | Manual stringify/parse | JSON.stringify/parse with Zod | Zod handles validation after parse |

**Key insight:** The project already has robust patterns for Redis pub/sub in indicator-calculation.service.ts. Follow that pattern exactly for subscriber setup, message handling, and cleanup.

## Common Pitfalls

### Pitfall 1: Subscriber Mode Lockout
**What goes wrong:** Trying to run regular Redis commands on a connection that's subscribed to channels fails silently or throws errors.
**Why it happens:** Redis connections in subscriber mode only accept SUBSCRIBE, PSUBSCRIBE, UNSUBSCRIBE, PUNSUBSCRIBE, PING, and QUIT commands.
**How to avoid:** Always use `redis.duplicate()` for the subscriber connection. Keep main connection for publishing and other operations.
**Warning signs:** "Command not allowed" errors, commands timing out on subscriber connection.

### Pitfall 2: Message Loss on Disconnect
**What goes wrong:** Commands sent while API is disconnected are lost forever.
**Why it happens:** Redis pub/sub is fire-and-forget with at-most-once delivery. No message persistence.
**How to avoid:** For this phase, this is acceptable (commands are user-initiated, they can retry). Document this limitation. For production-critical commands, would need Redis Streams or message queue.
**Warning signs:** Commands sent during API restart never execute.

### Pitfall 3: No Correlation ID Matching
**What goes wrong:** Admin UI can't match which response belongs to which command.
**Why it happens:** Multiple commands in flight, responses arrive out of order.
**How to avoid:** Always include correlationId in both command and response. Client maintains Map<correlationId, Promise resolver>.
**Warning signs:** UI shows wrong response for wrong command, race conditions.

### Pitfall 4: Timeout Accumulation
**What goes wrong:** Old commands execute long after they should have expired.
**Why it happens:** Not checking command timestamp on receipt.
**How to avoid:** Check `Date.now() - command.timestamp > 30000` before processing. Return error response for expired commands.
**Warning signs:** Stale commands executing, backfills running for removed symbols.

### Pitfall 5: Priority Queue Starvation
**What goes wrong:** High-priority commands block low-priority commands indefinitely.
**Why it happens:** Naive priority implementation only processes highest priority.
**How to avoid:** For this use case, it's acceptable since pause/resume should block other commands. Document this behavior.
**Warning signs:** Queue growing unboundedly, low-priority commands never execute.

## Code Examples

Verified patterns from official sources and existing codebase:

### Command Schema (Zod)
```typescript
// Source: Pattern from packages/schemas/src/settings/user-settings.schema.ts
import { z } from 'zod';

export const CommandTypeSchema = z.enum([
  'pause',
  'resume',
  'reload-settings',
  'switch-mode',
  'force-backfill',
  'clear-cache',
  'add-symbol',
  'remove-symbol',
]);

export const CommandSchema = z.object({
  correlationId: z.string().uuid(),
  type: CommandTypeSchema,
  payload: z.record(z.unknown()).optional(),
  timestamp: z.number(),
  priority: z.number().min(1).max(100),
});

export const CommandResponseSchema = z.object({
  correlationId: z.string().uuid(),
  status: z.enum(['ack', 'success', 'error']),
  message: z.string().optional(),
  data: z.unknown().optional(),
  timestamp: z.number(),
});

export type CommandType = z.infer<typeof CommandTypeSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type CommandResponse = z.infer<typeof CommandResponseSchema>;
```

### Control Channel Service Structure
```typescript
// Source: Pattern from apps/api/src/services/indicator-calculation.service.ts
import { getRedisClient } from '@livermore/cache';
import { createLogger } from '@livermore/utils';
import { CommandSchema, type Command, type CommandResponse } from '@livermore/schemas';
import type { Redis } from 'ioredis';

const logger = createLogger({ name: 'control-channel', service: 'control' });

export class ControlChannelService {
  private redis = getRedisClient();
  private subscriber: Redis | null = null;
  private identitySub: string;
  private commandChannel: string;
  private responseChannel: string;

  // Command timeout in ms (RUN-12)
  private readonly COMMAND_TIMEOUT_MS = 30_000;

  constructor(identitySub: string) {
    this.identitySub = identitySub;
    this.commandChannel = `livermore:commands:${identitySub}`;
    this.responseChannel = `livermore:responses:${identitySub}`;
  }

  async start(): Promise<void> {
    // Create dedicated subscriber (required for pub/sub mode)
    this.subscriber = this.redis.duplicate();

    await this.subscriber.subscribe(this.commandChannel);

    this.subscriber.on('message', (_channel: string, message: string) => {
      this.handleMessage(message).catch((error) => {
        logger.error({ error }, 'Error handling command message');
      });
    });

    logger.info({ channel: this.commandChannel }, 'Control channel started');
  }

  private async handleMessage(message: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      logger.error({ message }, 'Invalid JSON in command message');
      return;
    }

    const result = CommandSchema.safeParse(parsed);
    if (!result.success) {
      logger.error({ errors: result.error.errors }, 'Invalid command schema');
      return;
    }

    const command = result.data;

    // Check timeout (RUN-12)
    if (Date.now() - command.timestamp > this.COMMAND_TIMEOUT_MS) {
      await this.publishResponse({
        correlationId: command.correlationId,
        status: 'error',
        message: 'Command expired',
        timestamp: Date.now(),
      });
      return;
    }

    await this.handleCommand(command);
  }

  private async handleCommand(command: Command): Promise<void> {
    // Immediate ACK (RUN-10)
    await this.publishResponse({
      correlationId: command.correlationId,
      status: 'ack',
      timestamp: Date.now(),
    });

    // Execute and return result (RUN-11)
    // Command implementations will be in Phase 19
    try {
      const result = await this.executeCommand(command);
      await this.publishResponse({
        correlationId: command.correlationId,
        status: 'success',
        data: result,
        timestamp: Date.now(),
      });
    } catch (error) {
      await this.publishResponse({
        correlationId: command.correlationId,
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      });
    }
  }

  private async executeCommand(command: Command): Promise<unknown> {
    // Phase 19 will implement actual command handlers
    logger.info({ type: command.type, payload: command.payload }, 'Executing command');
    return { executed: true };
  }

  private async publishResponse(response: CommandResponse): Promise<void> {
    await this.redis.publish(this.responseChannel, JSON.stringify(response));
  }

  async stop(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe();
      await this.subscriber.quit();
      this.subscriber = null;
    }
    logger.info('Control channel stopped');
  }
}
```

### Channel Key Functions
```typescript
// Source: Add to packages/cache/src/keys.ts following existing pattern
/**
 * Build Redis pub/sub channel for control commands
 * Admin UI publishes commands, API subscribes
 */
export function commandChannel(identitySub: string): string {
  return `livermore:commands:${identitySub}`;
}

/**
 * Build Redis pub/sub channel for command responses
 * API publishes responses, Admin UI subscribes
 */
export function responseChannel(identitySub: string): string {
  return `livermore:responses:${identitySub}`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling for commands | Pub/sub for real-time | Always in Redis | Lower latency, no wasted requests |
| Shared connection pub/sub | Dedicated subscriber | ioredis v4+ | Prevents subscriber mode lockout |
| Manual message parsing | Zod schema validation | Project standard | Type safety, better errors |

**Deprecated/outdated:**
- None for this use case. Redis pub/sub API has been stable.

## Open Questions

Things that couldn't be fully resolved:

1. **Multi-instance API support**
   - What we know: Requirements say single API instance per user. Pub/sub works fine.
   - What's unclear: If future multi-instance needed, pub/sub broadcasts to all subscribers.
   - Recommendation: Keep current approach. Document that only one API should subscribe per user.

2. **Command history persistence**
   - What we know: UI-CTL-06 wants command history panel.
   - What's unclear: Should history be persisted in DB or just kept in memory on client?
   - Recommendation: For Phase 18, no persistence. Client keeps recent commands in memory. Consider DB persistence in later phase if needed.

3. **Authentication for commands**
   - What we know: Channel is scoped to identity_sub. API subscribes only to its user's channel.
   - What's unclear: How does Admin UI get identity_sub to publish to correct channel?
   - Recommendation: Admin UI uses Clerk's `user.id` (same as identity_sub). The tRPC auth context already has this.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `apps/api/src/services/indicator-calculation.service.ts` - pub/sub pattern with duplicate()
- Existing codebase: `packages/cache/src/keys.ts` - channel naming conventions
- Existing codebase: `packages/schemas/src/settings/user-settings.schema.ts` - Zod schema patterns
- [Redis Pub/Sub Official Docs](https://redis.io/docs/latest/develop/pubsub/) - at-most-once semantics, pattern subscribe

### Secondary (MEDIUM confidence)
- [ioredis GitHub](https://github.com/redis/ioredis) - duplicate() method, subscriber mode behavior
- [ioredis npm](https://www.npmjs.com/package/ioredis) - version confirmation (5.4.2)

### Tertiary (LOW confidence)
- Web search results for request-reply pattern - implementation patterns vary, adapted to project needs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - using existing dependencies
- Architecture: HIGH - following existing codebase patterns exactly
- Pitfalls: HIGH - documented from official sources and common patterns

**Research date:** 2026-01-31
**Valid until:** 2026-03-01 (30 days - stable Redis pub/sub API)
