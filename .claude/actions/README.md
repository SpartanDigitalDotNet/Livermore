# Claude Actions

Reusable executable scripts that Claude skills and ad-hoc commands call.
Each subdirectory is a category with its own README documenting the scripts.

**Usage pattern:**
```bash
NODE_ENV=development npx tsx .claude/actions/{category}/{script}.ts [args]
```

## Categories

| Directory | Purpose |
|-----------|---------|
| `claude-net/` | Inter-Claude network operations (inbox, messaging, state sync) |
| `queries/` | Database and Redis queries (alerts, candles, indicators) |
