---
name: perseus:claude-send
description: Send a message to another Claude's inbox via Redis Stream. Use for API contracts, task handoffs, heads-ups, questions, or conflict alerts between Mike's and Kaia's Claude instances.
argument-hint: "[kaia|mike] [type] [message]"
allowed-tools:
  - Bash
  - Read
---

<objective>
Send a structured message to another Claude's Redis inbox stream.
This enables asynchronous collaboration between Claude instances — API contract
changes, task handoffs, architecture decisions, conflict alerts, and questions.

The recipient's Claude will see the message on their next `/perseus:claude-sync`.

Sender identity is auto-detected from hostname via `claude:shared` hosts map.
</objective>

<critical_rules>
- NEVER look for .env files. Use environment variables from Windows User scope.
- ALWAYS use `NODE_ENV=development` when running action scripts.
- Use the permanent action script `.claude/actions/claude-net/send.ts` — do NOT write tmp scripts.
- ALWAYS confirm the message content with the user before sending (unless explicitly told to send without confirmation).
- Messages are permanent in the stream — do not send test/junk messages.
- Include enough context in the body for the receiving Claude to act without needing to ask questions.
- For API contract changes, include the exact interface/type definitions.
- For GSD tasks, include phase number and enough detail to create a PLAN.md.
</critical_rules>

<context>
## Action Script

Send messages via the permanent action script:
```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/send.ts <recipient> <type> <subject> [body]
```

## Message Types

| Type | When to Use |
|------|-------------|
| `heads-up` | Informational — "I changed X, you might want to update Y" |
| `api-contract` | API/schema change that affects the other's work |
| `task` | Work item for the other Claude |
| `question` | Asking the other Claude about something |
| `conflict-alert` | About to modify shared code — check for conflicts |

## Options

- `--priority urgent` — mark as urgent
- `--phase N` — GSD phase reference
</context>

<process>
Parse $ARGUMENTS to extract recipient, type, and message content.

## Step 1: Parse arguments

Expected format: `[recipient] [type] [subject/message]`
Examples:
- `/perseus:claude-send kaia heads-up Changed the CacheTrustAssessor logic`
- `/perseus:claude-send kaia task Please update BinanceAdapter reconnect`

If recipient is omitted, defaults to the OTHER Claude (mike->kaia, kaia->mike).
If type is omitted, defaults to `heads-up`.

## Step 2: Compose message

For simple messages, the subject from $ARGUMENTS is enough.
For complex messages (api-contract, task), compose a detailed body with context.

For GSD-compatible tasks, structure the body as:
```markdown
## Task: [subject]
**Phase:** [N] (if applicable)
**Priority:** [normal|urgent]
### Description
[Detailed description]
### Acceptance Criteria
- [ ] Criteria 1
### Context
[Code snippets, file paths, references]
```

## Step 3: Confirm with user

Display the formatted message and ask for confirmation before sending.

## Step 4: Send via action script

```bash
NODE_ENV=development npx tsx .claude/actions/claude-net/send.ts <recipient> <type> "<subject>" "<body>"
```

For multi-line bodies, write the body to a temp variable and pass it as a single quoted argument.

## Step 5: Confirm delivery

The script prints the message ID. Report: "Message sent to {recipient}'s inbox ({type}: {subject})"
</process>

<success_criteria>
- [ ] Sender identity auto-detected
- [ ] Recipient and message type parsed from arguments
- [ ] Message confirmed with user before sending
- [ ] Message sent via action script (no tmp/ files created)
- [ ] Delivery confirmed with stream entry ID
</success_criteria>
