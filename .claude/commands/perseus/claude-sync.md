---
name: perseus:claude-sync
description: Boot sequence — load shared knowledge, own state, and inbox messages from Redis. Run at session start to restore cross-session memory.
allowed-tools:
  - Bash
  - Read
---

<objective>
Restore cross-session context by reading from the Claude memory system in Redis.
This is the "boot" skill — run it at the start of every session to know what you've
learned, what the other Claude has been doing, and if there are messages waiting.

Three Redis key families:
- `claude:shared` — Shared knowledge corpus (both Claudes read/write)
- `claude:{name}:state` — Per-Claude session state (current work, observations)
- `claude:{name}:inbox` — Inter-Claude message stream (tasks, heads-ups, API contracts)

Identity is auto-detected from hostname via `claude:shared` hosts map.

Inbox uses Redis consumer groups for read/unread tracking. On sync, only NEW
messages are shown (via XREADGROUP), then ACKed to mark as read.
</objective>

<critical_rules>
- NEVER look for .env files. Use environment variables from Windows User scope.
- ALWAYS use `NODE_ENV=development` when running action scripts.
- Use the permanent action scripts under `.claude/actions/claude-net/` — do NOT write tmp scripts.
- NEVER modify `claude:shared` during sync — only read. Use learn mode to add entries.
- If keys don't exist yet, that's fine — report "first boot" and offer to seed initial data.
</critical_rules>

<context>
## Action Scripts

All network operations use permanent scripts — no tmp/ files needed.

| Action | Script |
|--------|--------|
| Full sync | `.claude/actions/claude-net/sync.ts` |
| Check inbox | `.claude/actions/claude-net/inbox.ts` |
| Update state | `.claude/actions/claude-net/state.ts` |
| Send message | `.claude/actions/claude-net/send.ts` |

## Redis Key Schemas

### claude:shared (String — JSON)
```json
{
  "lastUpdated": "ISO timestamp",
  "updatedBy": "mike|kaia",
  "gotchas": [{ "added": "YYYY-MM-DD", "by": "mike|kaia", "text": "..." }],
  "environment": { "key": "value" },
  "architecture": {
    "exchanges": { "1": "Coinbase", "2": "Binance", "3": "BinanceUS", "4": "Kraken" },
    "hosts": { "DESKTOP-UE1T19I": "Mike", "DESKTOP-5FK78SF": "Kaia" }
  }
}
```

### claude:{name}:state (String — JSON)
```json
{
  "lastSession": "ISO timestamp",
  "currentWork": "Brief description",
  "recentChanges": ["Array of changes"],
  "instanceObservations": { "coinbase": { "state": "active", "at": "ISO" } }
}
```

### claude:{name}:inbox (Redis Stream with Consumer Group)
Fields: from, type, subject, body, priority, gsdPhase, sentAt
Consumer group: `readers` (created idempotently on first use)
</context>

<process>
Parse $ARGUMENTS to determine mode. Default to full sync if no argument.

## Mode: (default) — Full sync

Run the sync action script:
```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/sync.ts
```

This handles everything: identity detection, shared knowledge, own state, and inbox (with consumer group ACK).

Present the output to the user as the boot report.

## Mode: inbox — Check inbox only

```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/inbox.ts
```

Or to see full history with read/unread markers:
```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/inbox.ts --all
```

## Mode: learn — Add to shared knowledge

Read current `claude:shared`, append the new gotcha entry, write back.
This is the ONE mode that still writes an inline script since it requires
dynamic content from the user's message.

## Mode: state — Update own session state

```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/state.ts --work "description"
```

Or with changes:
```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/state.ts --work "description" --changes "change1" "change2"
```

## Mode: observe — Record instance observation

```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/state.ts --observe coinbase active
```
</process>

<success_criteria>
- [ ] Identity determined from hostname
- [ ] Shared knowledge loaded and summarized
- [ ] Own state loaded (or "first boot" if missing)
- [ ] Inbox: only NEW messages shown on default sync (via XREADGROUP)
- [ ] Inbox: messages ACKed after display (via XACK)
- [ ] Consumer group created idempotently (no errors on re-sync)
- [ ] Used action scripts — no tmp/ files created
</success_criteria>
