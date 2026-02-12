---
name: perseus:env
description: Check environment variable setup — env vars are injected via .ps1, NOT .env files
allowed-tools:
  - Bash
  - Read
---

<objective>
Validate that all required environment variables are set in Windows User scope.
This skill exists to prevent wasting tokens looking for .env files — Livermore NEVER uses .env files.
Environment variables are stored in Windows User scope and injected into processes via PowerShell scripts.
</objective>

<critical_rules>
- NEVER look for .env files. They do not exist in this project.
- NEVER suggest creating .env files.
- NEVER use dotenv or any .env loading library.
- Environment variables are set via: [Environment]::SetEnvironmentVariable('NAME', 'VALUE', 'User')
- Environment variables are read in .ps1 scripts via: [Environment]::GetEnvironmentVariable('NAME', 'User')
- The .ps1 scripts inject them into the process environment before launching Node/Turbo.
</critical_rules>

<context>
## Required Environment Variables (11 required, 1 optional)

### Database (PostgreSQL)
- `DATABASE_HOST` — PostgreSQL host
- `DATABASE_PORT` — PostgreSQL port
- `DATABASE_LIVERMORE_USERNAME` — PostgreSQL username
- `DATABASE_LIVERMORE_PASSWORD` — PostgreSQL password
- `LIVERMORE_DATABASE_NAME` — Database name

### Redis
- `LIVERMORE_REDIS_URL` — Redis connection URL (format: `rediss://:PASSWORD@HOST:PORT`)

### Coinbase
- `Coinbase_ApiKeyId` — Coinbase API Key ID
- `Coinbase_EcPrivateKeyPem` — Coinbase EC Private Key (PEM format)

### Discord
- `DISCORD_LIVERMORE_BOT` — Discord webhook URL

### Clerk (Auth)
- `CLERK_PUBLISHABLE_KEY` — Clerk publishable key
- `CLERK_SECRET_KEY` — Clerk secret key
- `CLERK_WEBHOOK_SIGNING_SECRET` — (optional) Clerk webhook signing secret

## PowerShell Scripts That Inject Env Vars

| Script | Injects | Launches |
|--------|---------|----------|
| `scripts/run-api-dev.ps1` | All 12 vars + API_PORT=4000, NODE_ENV=development | `pnpm dev:api` |
| `scripts/run-admin-dev.ps1` | VITE_CLERK_PUBLISHABLE_KEY, VITE_API_URL | `pnpm dev:admin` |
| `run.ps1` | Calls check-env-vars.ps1 then starts both | API + Admin |
| `pull-and-run.ps1` | Same as run.ps1 + git pull + pnpm install | Full refresh |
| `check-env-vars.ps1` | None (validation only) | N/A |

## Turbo PassThrough (turbo.json)
Turbo is configured to pass through these env var patterns:
`NODE_ENV`, `DATABASE_*`, `LIVERMORE_*`, `Coinbase_*`, `DISCORD_*`, `CLERK_*`, `VITE_*`, `API_*`
</context>

<process>
## 1. Validate Environment Variables

Run the existing check script:

```bash
powershell -File check-env-vars.ps1
```

## 2. If the check script is unavailable, manually verify

```bash
powershell -Command "[Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User')"
```

Check each required variable exists in Windows User scope. Report which are set and which are missing.

## 3. Report

Output a table showing each variable's status (set/missing) with masked previews for secrets.
</process>

<success_criteria>
- [ ] All 11 required env vars verified in Windows User scope
- [ ] No .env files referenced or created
- [ ] Clear report of any missing variables
</success_criteria>
