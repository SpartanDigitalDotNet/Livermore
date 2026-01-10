# Livermore Project Constitution

## Purpose

Track the user's current account positions on Coinbase.

## Project Structure

```
Livermore/
├── apps/                    # Applications
│   └── api/                 # Backend API server
├── packages/                # Shared packages
│   ├── cache/               # Redis caching
│   ├── coinbase-client/     # Coinbase API client
│   ├── database/            # PostgreSQL with Drizzle
│   ├── schemas/             # Zod schemas
│   ├── trpc-config/         # tRPC configuration
│   └── utils/               # Shared utilities
├── scripts/                 # Development scripts
├── tests/                   # Test harnesses
│   ├── manual/              # Manual test scripts
│   └── integration/         # Integration tests
└── docker/                  # Docker configuration
```

## Testing

### Folder Structure

- **Unit tests**: Colocated with source code in `__tests__/` folders within each package
- **Integration tests**: `tests/integration/`
- **Manual test harnesses**: `tests/manual/`

### Naming Convention

- Unit tests: `*.test.ts`
- Integration tests: `*.integration.test.ts`
- Manual test scripts: `test-*.ts`

## Code Changes

Do not modify code without explicit authorization from the user.
