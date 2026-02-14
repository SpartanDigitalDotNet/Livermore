---
name: perseus:claude-send
description: Send a message to another Claude's inbox via Redis Stream. Use for API contracts, task handoffs, heads-ups, questions, or conflict alerts between Mike's and Kaia's Claude instances.
argument-hint: "[kaia|mike] [type] [message]"
allowed-tools:
  - Bash
  - Read
  - Write
---

<objective>
Send a structured message to another Claude's Redis inbox stream.
This enables asynchronous collaboration between Claude instances — API contract
changes, task handoffs, architecture decisions, conflict alerts, and questions.

The recipient's Claude will see the message on their next `/perseus:claude-sync`.

Sender identity is auto-detected by looking up the machine hostname in
the `claude:shared` hosts map (architecture.hosts). No hardcoded hostnames.
</objective>

<critical_rules>
- NEVER look for .env files. Use environment variables from Windows User scope.
- ALWAYS use `NODE_ENV=development` when running scripts.
- ALWAYS write scripts to `tmp/` and clean up after.
- ALWAYS confirm the message content with the user before sending (unless explicitly told to send without confirmation).
- Messages are permanent in the stream — do not send test/junk messages.
- Include enough context in the body for the receiving Claude to act without needing to ask questions.
- For API contract changes, include the exact interface/type definitions.
- For GSD tasks, include phase number and enough detail to create a PLAN.md.
</critical_rules>

<context>
## Message Types

| Type | When to Use | Example |
|------|-------------|---------|
| `heads-up` | Informational — "I changed X, you might want to update Y" | "Changed InstanceStatus schema, added new field" |
| `api-contract` | API/schema change that affects the other's work | "New tRPC endpoint network.getWarmupStats — here's the shape" |
| `task` | Work item for the other Claude — can include GSD phase | "Please add Binance WebSocket reconnect logic" |
| `question` | Asking the other Claude about something | "What format does the Binance kline timestamp use?" |
| `conflict-alert` | About to modify shared code — check for conflicts | "I'm refactoring instance-registry.service.ts" |

## Inbox Stream Schema

Redis Stream key: `claude:{recipient}:inbox`

Each XADD entry has these fields:
- `from` — sender identity (mike|kaia)
- `type` — one of: task, heads-up, api-contract, question, conflict-alert
- `subject` — brief subject (< 100 chars)
- `body` — full markdown message (can be multi-line, detailed)
- `priority` — normal|urgent
- `gsdPhase` — optional phase number (for GSD integration)
- `sentAt` — ISO timestamp
</context>

<process>
Parse $ARGUMENTS to extract recipient, type, and message content.

## Step 1: Determine sender identity
Look up hostname in the `claude:shared` hosts map:
```typescript
import { hostname } from 'node:os';
const host = hostname();
const shared = JSON.parse(await redis.get('claude:shared'));
const sender = shared?.architecture?.hosts?.[host]?.toLowerCase();
if (!sender) {
  // Unknown host — ask user who they are, then register in hosts map
}
```

## Step 2: Parse arguments
Expected format: `[recipient] [type] [subject/message]`
Examples:
- `/perseus:claude-send kaia heads-up Changed the CacheTrustAssessor logic`
- `/perseus:claude-send kaia api-contract New warmup stats endpoint shape`
- `/perseus:claude-send kaia task Please update BinanceAdapter reconnect`

If recipient is omitted, default to the OTHER Claude (mike→kaia, kaia→mike).
If type is omitted, default to `heads-up`.

## Step 3: Compose message
Build the message object. For complex messages (api-contract, task), prompt
the user for the full body if only a subject was provided.

For GSD-compatible tasks, structure the body as:
```markdown
## Task: [subject]

**Phase:** [N] (if applicable)
**Priority:** [normal|urgent]

### Description
[Detailed description of what needs to be done]

### Acceptance Criteria
- [ ] Criteria 1
- [ ] Criteria 2

### Context
[Any relevant code snippets, file paths, or references]
```

## Step 4: Confirm with user
Display the formatted message and ask for confirmation before sending.

## Step 5: Send via XADD
Write a tmp/ script:
```typescript
import { getRedisClient } from '@livermore/cache';

async function main() {
  const redis = getRedisClient();
  const id = await redis.xadd(
    'claude:RECIPIENT:inbox',
    '*',  // auto-generate ID
    'from', 'SENDER',
    'type', 'TYPE',
    'subject', 'SUBJECT',
    'body', 'BODY',
    'priority', 'PRIORITY',
    'gsdPhase', 'PHASE_OR_EMPTY',
    'sentAt', new Date().toISOString()
  );
  console.log(`Message sent: ${id}`);
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

## Step 6: Confirm delivery
Print: "Message sent to {recipient}'s inbox ({type}: {subject})"

## Cleanup
Always delete tmp/ scripts after execution.
</process>

<success_criteria>
- [ ] Sender identity auto-detected
- [ ] Recipient and message type parsed from arguments
- [ ] Message confirmed with user before sending
- [ ] Message written to recipient's inbox stream via XADD
- [ ] Delivery confirmed with stream entry ID
- [ ] Temporary scripts cleaned up
</success_criteria>
