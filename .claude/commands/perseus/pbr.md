---
name: perseus:pbr
description: Pull-Build-Run — pull latest code, install deps, build, and report. Optionally notify another Claude to do the same.
argument-hint: "[kaia|mike]"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Write
  - Skill
---

<objective>
Pull the latest code, install dependencies, build the workspace, and report results.
This is the standard refresh cycle after changes are pushed to the branch.

When a recipient (kaia or mike) is specified, sends a PBR request to that Claude's
inbox via perseus:claude-send instead of running locally. The recipient's Claude
will pick it up on their next /perseus:claude-sync and execute locally.
</objective>

<critical_rules>
- NEVER run `git pull` if there are uncommitted changes — warn the user and stop.
- NEVER auto-restart dev servers. Report what changed and remind the user to restart.
- If `git pull` says "Already up to date", still run install + build (deps may have changed locally).
- Use `pnpm install` (not `pnpm install --frozen-lockfile`) — the lockfile may have changed upstream.
- Use `pnpm run build` for normal builds. Use `pnpm run rebuild` if the user says "force" or if build fails with stale cache errors.
- NEVER look for .env files. Environment variables come from Windows User scope via PowerShell scripts.
- When sending to another Claude, use the perseus:claude-send skill — do not reimplement XADD.
</critical_rules>

<context>
## Dev Server Scripts

Both machines run dev servers via PowerShell scripts that load env vars and start foreground processes:

| Script | What it runs | Port |
|--------|-------------|------|
| `.\scripts\run-api-dev.ps1` | `pnpm dev:api` (Fastify API) | 4000 |
| `.\scripts\run-admin-dev.ps1` | `pnpm dev:admin` (Vite React) | 5173 |

These are foreground terminal processes — Claude cannot restart them.
After a PBR, remind the user to restart any running dev servers.

## Branch Convention

Both machines work on the same branch (`Binance-Wireup` currently).
`git pull` should fast-forward without merge conflicts in normal workflow.

## Build System

- `pnpm run build` runs `turbo run build` (cached, dependency-aware)
- `pnpm run rebuild` runs `turbo run build --force` (cache-busted)
- Full build takes 30-60 seconds typically
</context>

<process>

## Parse Arguments

Check $ARGUMENTS for a recipient name (kaia or mike).

- If a recipient is specified → go to **Remote PBR**
- If no arguments → go to **Local PBR**

---

## Remote PBR

Send a PBR request to the other Claude via claude-send.

1. Determine what branch we're on and what was just pushed:
   ```bash
   git log --oneline -3
   ```

2. Use the `perseus:claude-send` skill to send a task:
   - Recipient: the specified name (kaia or mike)
   - Type: `task`
   - Subject: `PBR — pull and rebuild on [branch]`
   - Body: Include the recent commit messages and any specific notes about what changed (e.g., "renamed coinbaseAdapter to exchangeAdapter across 3 files — type-level change, needs full rebuild").

3. Done. The recipient will run `/perseus:pbr` locally on their next sync.

---

## Local PBR

### Step 1: Pre-flight checks

```bash
git status --porcelain
```

- If output is non-empty, **warn the user** about uncommitted changes and STOP.
  - Exception: untracked files in `tmp/`, `data/`, or build artifacts are OK to ignore.
- If clean, proceed.

### Step 2: Pull

```bash
git pull
```

- Report what happened: "Already up to date" or list of changed files.
- If pull fails (merge conflict, diverged history), report the error and STOP.

### Step 3: Install

```bash
pnpm install
```

- This ensures any new/changed dependencies are installed.
- The postinstall hook runs `turbo run build` automatically, but we run build explicitly in Step 4 for clear reporting.

### Step 4: Build

```bash
pnpm run build
```

Use a 5-minute timeout.

- Parse the Turbo summary line: `Tasks: N successful, M total`
- If all passed, report success with cached/rebuilt counts and build time.
- If any failed, report the failure with error details and suggested fix.

### Step 5: Report

Output a summary:

```
PBR Complete
  Pull:    [N commits pulled | Already up to date]
  Install: [OK | N packages updated]
  Build:   [N/M packages passed, X cached]

  Reminder: Restart dev servers if running
    .\scripts\run-api-dev.ps1
    .\scripts\run-admin-dev.ps1
```

If specific packages were affected by the pull (check `git diff --name-only HEAD~N..HEAD` against package paths), highlight which dev servers need restarting.
</process>

<success_criteria>
- [ ] Pre-flight check caught uncommitted changes (or confirmed clean)
- [ ] `git pull` executed and result reported
- [ ] `pnpm install` executed
- [ ] `pnpm run build` executed and per-package results reported
- [ ] User reminded to restart dev servers
- [ ] For remote PBR: message sent via claude-send with branch and commit context
</success_criteria>
