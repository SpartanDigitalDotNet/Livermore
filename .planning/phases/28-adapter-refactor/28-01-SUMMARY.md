# Summary: Phase 28-01 Adapter Factory and Connection Tracking

**Status:** Complete
**Executed:** 2026-02-06

## What Was Built

Created exchange adapter factory pattern with connection status tracking:

1. **ExchangeAdapterFactory** (`apps/api/src/services/exchange/adapter-factory.ts`):
   - Looks up exchange configuration from database by ID
   - Instantiates correct adapter type based on `exchanges.name`
   - Currently supports: `coinbase` → CoinbaseAdapter
   - Designed for extensibility: add switch cases for binance, binanceus, etc.

2. **Connection Status Tracking** (EXC-04):
   - Stores connection state in Redis: `exchange:status:{exchangeId}`
   - Tracks: connectionState, connectedAt, lastHeartbeat, error
   - Event listeners: connected, disconnected, error, reconnecting
   - States: idle, connecting, connected, disconnected, error

3. **Database Schema** (`packages/database/src/schema/exchanges.ts`):
   - Added exchanges schema export for TypeScript access
   - Matches existing table created in Phase 23

## Files Created/Modified

- `apps/api/src/services/exchange/adapter-factory.ts` - New factory and connection tracking
- `apps/api/src/services/exchange/index.ts` - New export index
- `packages/database/src/schema/exchanges.ts` - New schema export
- `packages/database/src/schema/index.ts` - Added exchanges export

## Verification

- [x] ExchangeAdapterFactory.create(exchangeId) returns CoinbaseAdapter
- [x] Factory looks up exchange by ID from database
- [x] Connection status stored in Redis `exchange:status:1`
- [x] Event listeners track connection lifecycle
- [x] Full turbo build passes

## Requirements Satisfied

- **EXC-03**: Exchange adapter factory instantiates correct adapter by exchange type
- **EXC-04**: Connection status tracking (connected_at, last_heartbeat, connection_state)

## Usage Example

```typescript
import { ExchangeAdapterFactory } from './services/exchange';

const factory = new ExchangeAdapterFactory({
  apiKeyId: config.Coinbase_ApiKeyId,
  privateKeyPem: config.Coinbase_EcPrivateKeyPem,
  redis,
  userId: 1,
});

// Create adapter by exchange ID (database lookup)
const adapter = await factory.create(1); // Returns CoinbaseAdapter

// Connection status available via Redis
const status = await factory.getConnectionStatus(1);
// { exchangeId: 1, exchangeName: 'coinbase', connectionState: 'connected', ... }
```

## Notes

- Factory is in apps/api (not coinbase-client) to access database without circular dependency
- Server.ts still uses direct CoinbaseAdapter instantiation; can be migrated to factory in future
- Future exchanges (binance, binanceus) add switch cases in createAdapterByType()
