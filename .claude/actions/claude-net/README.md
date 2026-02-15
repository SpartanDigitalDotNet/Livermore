# Claude Network Actions

Reusable scripts for inter-Claude communication, state management, and inbox operations.
Identity is auto-detected from the machine hostname via the `claude:shared` hosts map.

## Scripts

### inbox.ts — Check inbox messages
```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/inbox.ts           # new messages only (ACKs after display)
NODE_ENV=development npx tsx .claude/actions/claude-net/inbox.ts --all     # full history with [NEW]/[READ] markers
NODE_ENV=development npx tsx .claude/actions/claude-net/inbox.ts --peek    # new messages without ACKing
NODE_ENV=development npx tsx .claude/actions/claude-net/inbox.ts --count 5 # limit to N messages (default 100)
```

### send.ts — Send message to another Claude
```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/send.ts <recipient> <type> <subject> [body]
NODE_ENV=development npx tsx .claude/actions/claude-net/send.ts kaia task "PBR needed" "Pull and rebuild"
NODE_ENV=development npx tsx .claude/actions/claude-net/send.ts kaia heads-up "Changed schema"
```
- `recipient`: kaia or mike (omit to auto-detect the other Claude)
- `type`: task, heads-up, api-contract, question, conflict-alert (default: heads-up)
- `--priority urgent` for urgent messages
- `--phase N` for GSD phase reference

### sync.ts — Full boot sync
```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/sync.ts             # full sync
NODE_ENV=development npx tsx .claude/actions/claude-net/sync.ts --inbox-only  # just check inbox
NODE_ENV=development npx tsx .claude/actions/claude-net/sync.ts --no-ack     # don't mark messages as read
```

### state.ts — Update own session state
```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/state.ts --work "Current task description"
NODE_ENV=development npx tsx .claude/actions/claude-net/state.ts --work "Task" --changes "Change 1" "Change 2"
NODE_ENV=development npx tsx .claude/actions/claude-net/state.ts --observe coinbase active
```

## Redis Keys

| Key | Type | Purpose |
|-----|------|---------|
| `claude:shared` | String (JSON) | Shared knowledge corpus |
| `claude:{name}:state` | String (JSON) | Per-Claude session state |
| `claude:{name}:inbox` | Stream + Consumer Group | Inter-Claude messages |

Consumer group `readers` is created idempotently on first use per inbox.
