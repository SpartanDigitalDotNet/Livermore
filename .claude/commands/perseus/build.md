---
name: perseus:build
description: Build all packages and report results per package
allowed-tools:
  - Bash
  - Read
  - Grep
---

<objective>
Run a full workspace build via Turbo and report pass/fail status for each package.
Knows the package dependency order, common failure modes, and how to interpret Turbo output.
</objective>

<critical_rules>
- The build command is `pnpm run build` (runs `turbo run build` under the hood).
- For a cache-busting rebuild use `pnpm run rebuild` (runs `turbo run build --force`).
- Environment variables are NOT needed for build — only for runtime.
- If a package fails with "'tsup' is not recognized", the fix is `pnpm install` (missing node_modules).
- The postinstall hook runs `turbo run build` automatically after `pnpm install`.
</critical_rules>

<context>
## Package Build Order (dependency chain)

1. `@livermore/schemas` — Zod schemas, type definitions (tsup)
2. `@livermore/utils` — Logger, env validation (tsup)
3. `@livermore/cache` — Redis client, key builders (tsup)
4. `@livermore/database` — PostgreSQL schema, Drizzle ORM (tsup)
5. `@livermore/exchange-core` — Exchange adapters, base adapter (tsup)
6. `@livermore/indicators` — MACD-V, technical indicators (tsup)
7. `@livermore/binance-client` — Binance-specific client (tsup)
8. `@livermore/charts` — Chart generation (tsup)
9. `@livermore/trpc-config` — tRPC router config (tsup)
10. `@livermore/api` — Fastify API server (tsup)
11. `@livermore/admin` — Vite React admin UI (vite build)

## Turbo Configuration
- `build` depends on `^build` (all deps must build first)
- Output logs: `errors-only` (only shows failures)
- Cache: enabled (use `--force` to skip)

## Common Failures

| Error | Cause | Fix |
|-------|-------|-----|
| `'tsup' is not recognized` | Missing node_modules | `pnpm install` |
| Type errors in dependent packages | Stale build cache | `pnpm run rebuild` |
| `Cannot find module '@livermore/...'` | Dependency not built | `pnpm run rebuild` |
| Admin vite build fails on types | Package types not generated | `pnpm run rebuild` |
</context>

<process>
## 1. Run Build

```bash
pnpm run build
```

Use a 5-minute timeout. The full build typically takes 30-60 seconds.

## 2. Parse Results

Look for the Turbo summary line:
```
Tasks:    N successful, M total
Cached:   X cached, M total
```

- If `N successful == M total` → all packages passed
- If any failed, Turbo lists the failed package names

## 3. Report

Output a summary:
- Total packages: pass/fail count
- Cached vs rebuilt count
- Build time
- Any failures with the specific error and recommended fix from the common failures table

## 4. If build fails

Read the error output and match against the common failures table. Suggest the specific fix.
Do NOT attempt to fix the issue automatically — report it to the user.
</process>

<success_criteria>
- [ ] Build command executed
- [ ] Per-package status reported
- [ ] Any failures explained with fix recommendations
- [ ] Build time reported
</success_criteria>
