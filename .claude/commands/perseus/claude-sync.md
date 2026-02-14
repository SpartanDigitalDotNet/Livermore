---
name: perseus:claude-sync
description: Boot sequence — load shared knowledge, own state, and inbox messages from Redis. Run at session start to restore cross-session memory.
allowed-tools:
  - Bash
  - Read
  - Write
---

<objective>
Restore cross-session context by reading from the Claude memory system in Redis.
This is the "boot" skill — run it at the start of every session to know what you've
learned, what the other Claude has been doing, and if there are messages waiting.

Three Redis key families:
- `claude:shared` — Shared knowledge corpus (both Claudes read/write)
- `claude:{name}:state` — Per-Claude session state (current work, observations)
- `claude:{name}:inbox` — Inter-Claude message stream (tasks, heads-ups, API contracts)

Identity is determined by reading the host→name mapping from `claude:shared`
(the `architecture.hosts` object), matched against the machine's hostname.
This avoids hardcoding — either Claude can register new machines by updating
the shared hosts map.

Inbox uses Redis consumer groups for read/unread tracking. On sync, only NEW
messages are shown (via XREADGROUP), then ACKed to mark as read. Use `inbox`
mode to review full message history with [NEW]/[READ] markers.
</objective>

<critical_rules>
- NEVER look for .env files. Use environment variables from Windows User scope.
- ALWAYS use `NODE_ENV=development` when running scripts.
- ALWAYS write scripts to `tmp/` and clean up after.
- NEVER modify `claude:shared` during sync — only read. Use learn mode to add entries.
- After displaying inbox messages, ACK them to mark as read. Messages stay in the stream permanently.
- If keys don't exist yet, that's fine — report "first boot" and offer to seed initial data.
- Consumer group `readers` is created idempotently on every sync (MKSTREAM + ignore BUSYGROUP).
</critical_rules>

<context>
## Redis Key Schemas

### claude:shared (String — JSON)
Shared knowledge corpus. Both Claudes contribute. Append-only for gotchas.
```json
{
  "lastUpdated": "ISO timestamp",
  "updatedBy": "mike|kaia",
  "gotchas": [
    { "added": "YYYY-MM-DD", "by": "mike|kaia", "text": "Description of the gotcha" }
  ],
  "environment": {
    "key": "value pairs of env/tooling knowledge"
  },
  "architecture": {
    "exchanges": { "1": "Coinbase", "2": "Binance", "3": "BinanceUS", "4": "Kraken" },
    "hosts": { "DESKTOP-UE1T19I": "Mike", "DESKTOP-5FK78SF": "Kaia" }
  }
}
```

### claude:{name}:state (String — JSON)
Per-Claude session state. Overwritten each session.
```json
{
  "lastSession": "ISO timestamp",
  "currentWork": "Brief description of current focus",
  "recentChanges": ["Array of recent changes made"],
  "instanceObservations": {
    "coinbase": { "state": "active", "at": "ISO timestamp" },
    "binance": { "state": "starting", "at": "ISO timestamp" }
  }
}
```

### claude:{name}:inbox (Redis Stream with Consumer Group)
Messages from the other Claude. Each entry has fields:
- `from` — sender name (mike|kaia)
- `type` — message type (task|heads-up|api-contract|question|conflict-alert)
- `subject` — brief subject line
- `body` — full markdown message
- `priority` — normal|urgent
- `gsdPhase` — optional GSD phase reference

Consumer group: `readers` (created on first sync per inbox)
Consumer name: identity (mike or kaia)
Read tracking: XREADGROUP returns only unread messages, XACK marks as read
</context>

<process>
Parse $ARGUMENTS to determine mode. Default to full sync if no argument.

## Mode: (default) — Full sync

### Step 1: Determine identity
Read `claude:shared` first, then look up hostname in `architecture.hosts`:
```typescript
import { hostname } from 'node:os';
const host = hostname();
const shared = JSON.parse(await redis.get('claude:shared'));
const identity = shared?.architecture?.hosts?.[host]?.toLowerCase();
if (!identity) {
  console.log(`Unknown host: ${host}. Add it to claude:shared architecture.hosts.`);
  // Prompt the user for their name and add it to the hosts map
}
```
This is dynamic — no hardcoded hostnames. Either Claude can register new
machines by updating the hosts map in `claude:shared`.

### Step 2: Read shared knowledge
```typescript
const shared = await redis.get('claude:shared');
```
Display a summary of gotchas count, last updated, key environment notes.

### Step 3: Read own state
```typescript
const state = await redis.get(`claude:${identity}:state`);
```
Display last session time, current work, recent changes, instance observations.

### Step 4: Read inbox (consumer group)
```typescript
const inboxKey = `claude:${identity}:inbox`;

// Create consumer group idempotently
try {
  await redis.xgroup('CREATE', inboxKey, 'readers', '0', 'MKSTREAM');
} catch (e: any) {
  if (!e.message?.includes('BUSYGROUP')) throw e;
  // Group already exists — fine
}

// Read only NEW (undelivered) messages
const results = await redis.xreadgroup(
  'GROUP', 'readers', identity,
  'COUNT', 100, 'STREAMS', inboxKey, '>'
);

// results is null if no new messages, or [[key, [[id, fields], ...]]]
const newMessages = results?.[0]?.[1] ?? [];

if (newMessages.length === 0) {
  console.log('No new messages.');
} else {
  console.log(`${newMessages.length} new message(s):`);
  const messageIds: string[] = [];
  for (const [id, fields] of newMessages) {
    messageIds.push(id);
    // Parse fields array into object
    const msg: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      msg[fields[i]] = fields[i + 1];
    }
    const urgent = msg.priority === 'urgent' ? ' [URGENT]' : '';
    console.log(`\n--- [NEW] ${id}${urgent} ---`);
    console.log(`From: ${msg.from} | Type: ${msg.type} | Sent: ${msg.sentAt}`);
    console.log(`Subject: ${msg.subject}`);
    console.log(`Body:\n${msg.body}`);
  }

  // ACK all displayed messages to mark as read
  if (messageIds.length > 0) {
    await redis.xack(inboxKey, 'readers', ...messageIds);
  }
}
```

### Step 5: Summary
Print a concise boot report:
- Identity (name, hostname)
- Shared knowledge: X gotchas loaded
- Own state: last session, current work
- Inbox: N new messages (N urgent)

## Mode: inbox — Review all messages with read/unread status

Show full message history with `[NEW]` or `[READ]` markers.
Optional argument: `unread` to show only unread messages.

```
/perseus:claude-sync inbox        — all messages with read/unread markers
/perseus:claude-sync inbox unread  — only unread messages
```

```typescript
const inboxKey = `claude:${identity}:inbox`;

// Create consumer group idempotently
try {
  await redis.xgroup('CREATE', inboxKey, 'readers', '0', 'MKSTREAM');
} catch (e: any) {
  if (!e.message?.includes('BUSYGROUP')) throw e;
}

// Get pending (unread) message IDs
const pendingInfo = await redis.xpending(inboxKey, 'readers');
// pendingInfo = [count, minId, maxId, [[consumer, count], ...]]
const pendingCount = pendingInfo[0] as number;

// Get detailed pending entries to build the unread set
const pendingSet = new Set<string>();
if (pendingCount > 0) {
  const pendingDetails = await redis.xpending(
    inboxKey, 'readers', '-', '+', pendingCount
  );
  for (const entry of pendingDetails) {
    pendingSet.add(entry[0]); // message ID
  }
}

// Get full message history
const allMessages = await redis.xrange(inboxKey, '-', '+');

for (const [id, fields] of allMessages) {
  const isUnread = pendingSet.has(id);
  const marker = isUnread ? '[NEW]' : '[READ]';

  // If "unread" filter specified, skip read messages
  if (filterUnread && !isUnread) continue;

  const msg = parseFields(fields);
  console.log(`\n--- ${marker} ${id} ---`);
  console.log(`From: ${msg.from} | Type: ${msg.type} | Sent: ${msg.sentAt}`);
  console.log(`Subject: ${msg.subject}`);
  console.log(`Body:\n${msg.body}`);
}
```

Note: `inbox` mode does NOT ACK messages — it's read-only browsing.
Only the default sync mode ACKs messages.

## Mode: learn — Add to shared knowledge
Add a gotcha or environment note to `claude:shared`.
Argument: the text to add.
```
/perseus:claude-sync learn NODE_ENV must be 'development' not 'dev'
```

Read current `claude:shared`, append the new entry, write back.

## Mode: state — Update own session state
Update `claude:{name}:state` with current work context.
Argument: brief description of current work.
```
/perseus:claude-sync state Working on dark mode implementation
```

## Mode: observe — Record instance observation
Update the instanceObservations in own state.
```
/perseus:claude-sync observe coinbase active
```

## Cleanup
Always delete tmp/ scripts after execution.
</process>

<success_criteria>
- [ ] Identity determined from hostname
- [ ] Shared knowledge loaded and summarized
- [ ] Own state loaded (or "first boot" if missing)
- [ ] Inbox: only NEW messages shown on default sync (via XREADGROUP)
- [ ] Inbox: messages ACKed after display (via XACK)
- [ ] Inbox mode: full history shown with [NEW]/[READ] markers
- [ ] Consumer group created idempotently (no errors on re-sync)
- [ ] Temporary scripts cleaned up
</success_criteria>
