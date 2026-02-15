/**
 * Claude Network Action: inbox
 *
 * Check inbox for messages using Redis consumer groups.
 *
 * Usage:
 *   npx tsx .claude/actions/claude-net/inbox.ts           # new messages (ACK after display)
 *   npx tsx .claude/actions/claude-net/inbox.ts --all     # full history with [NEW]/[READ]
 *   npx tsx .claude/actions/claude-net/inbox.ts --peek    # new messages without ACKing
 */
import { getRedisClient } from '@livermore/cache';
import { hostname } from 'node:os';

type RedisClient = ReturnType<typeof getRedisClient>;

async function getIdentity(redis: RedisClient) {
  const host = hostname();
  const sharedRaw = await redis.get('claude:shared');
  if (!sharedRaw) throw new Error('claude:shared key not found in Redis');
  const shared = JSON.parse(sharedRaw);
  const identity = shared?.architecture?.hosts?.[host]?.toLowerCase();
  if (!identity) throw new Error(`Unknown host: ${host}. Known: ${JSON.stringify(shared?.architecture?.hosts)}`);
  return identity as string;
}

function parseFields(fields: string[]): Record<string, string> {
  const msg: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    msg[fields[i]] = fields[i + 1];
  }
  return msg;
}

function formatMessage(id: string, fields: string[], marker?: string) {
  const msg = parseFields(fields);
  const urgent = msg.priority === 'urgent' ? ' [URGENT]' : '';
  const prefix = marker ? `${marker} ` : '';
  console.log(`\n--- ${prefix}${id}${urgent} ---`);
  console.log(`From: ${msg.from} | Type: ${msg.type} | Sent: ${msg.sentAt}`);
  console.log(`Subject: ${msg.subject}`);
  console.log(`Body:\n${msg.body}`);
}

async function ensureConsumerGroup(redis: RedisClient, key: string) {
  try {
    await redis.xgroup('CREATE', key, 'readers', '0', 'MKSTREAM');
  } catch (e: any) {
    if (!e.message?.includes('BUSYGROUP')) throw e;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const showAll = args.includes('--all');
  const peek = args.includes('--peek');

  let count = 100;
  const countIdx = args.indexOf('--count');
  if (countIdx !== -1 && args[countIdx + 1]) {
    count = parseInt(args[countIdx + 1], 10) || 100;
  }

  const redis = getRedisClient();
  const identity = await getIdentity(redis);
  const inboxKey = `claude:${identity}:inbox`;

  await ensureConsumerGroup(redis, inboxKey);

  if (showAll) {
    // Full history with [NEW]/[READ] markers
    const pendingSet = new Set<string>();
    const pendingInfo = await redis.xpending(inboxKey, 'readers') as any[];
    const pendingCount = typeof pendingInfo[0] === 'number' ? pendingInfo[0] : 0;

    if (pendingCount > 0) {
      const pendingDetails = await redis.xpending(inboxKey, 'readers', '-', '+', pendingCount) as any[];
      for (const entry of pendingDetails) {
        pendingSet.add(entry[0]);
      }
    }

    const allMessages = await redis.xrange(inboxKey, '-', '+');
    if (!allMessages || allMessages.length === 0) {
      console.log('No messages in inbox.');
    } else {
      console.log(`${allMessages.length} total message(s) (${pendingSet.size} unread):\n`);
      for (const [id, fields] of allMessages) {
        const marker = pendingSet.has(id) ? '[NEW]' : '[READ]';
        formatMessage(id, fields, marker);
      }
    }
  } else {
    // New messages only via consumer group
    const results = await redis.xreadgroup(
      'GROUP', 'readers', identity,
      'COUNT', count, 'STREAMS', inboxKey, '>'
    );

    const newMessages = results?.[0]?.[1] ?? [];

    if (newMessages.length === 0) {
      console.log('No new messages.');
    } else {
      console.log(`${newMessages.length} new message(s):\n`);
      const messageIds: string[] = [];
      for (const [id, fields] of newMessages) {
        messageIds.push(id);
        formatMessage(id, fields, '[NEW]');
      }

      if (!peek && messageIds.length > 0) {
        await redis.xack(inboxKey, 'readers', ...messageIds);
        console.log(`\nACKed ${messageIds.length} message(s)`);
      } else if (peek) {
        console.log(`\n(peek mode — messages NOT marked as read)`);
      }
    }

    const total = await redis.xlen(inboxKey);
    console.log(`Total in stream: ${total}`);
  }

  await redis.quit();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
