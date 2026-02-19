/**
 * Claude Network Action: send
 *
 * Send a message to another Claude's inbox via Redis Stream.
 *
 * Usage:
 *   npx tsx .claude/actions/claude-net/send.ts <recipient> <type> <subject> [body]
 *   npx tsx .claude/actions/claude-net/send.ts kaia task "PBR needed" "Pull and rebuild"
 *   npx tsx .claude/actions/claude-net/send.ts kaia heads-up "Changed schema"
 *
 * Options:
 *   --priority urgent    Mark as urgent (default: normal)
 *   --phase N            GSD phase reference
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
  const allIdentities = Object.values(shared.architecture.hosts).map((v: any) => v.toLowerCase());
  const other = allIdentities.find((id: string) => id !== identity) ?? null;
  return { identity: identity as string, other: other as string | null };
}

const VALID_TYPES = ['task', 'heads-up', 'api-contract', 'question', 'conflict-alert'];

async function main() {
  const args = process.argv.slice(2);

  // Extract named args
  let priority = 'normal';
  let phase = '';
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--priority' && args[i + 1]) {
      priority = args[++i];
    } else if (args[i] === '--phase' && args[i + 1]) {
      phase = args[++i];
    } else {
      positional.push(args[i]);
    }
  }

  const redis = getRedisClient();
  const { identity, other } = await getIdentity(redis);

  // Parse positional: [recipient] [type] <subject> [body]
  let recipient: string;
  let type: string;
  let subject: string;
  let body: string;

  if (positional.length < 1) {
    console.error('Usage: send.ts <recipient> <type> <subject> [body]');
    console.error('  recipient: kaia, mike (or omit to auto-detect)');
    console.error(`  type: ${VALID_TYPES.join(', ')} (default: heads-up)`);
    await redis.quit();
    process.exit(1);
  }

  // Determine what the first arg is: recipient, type, or subject
  if (['mike', 'kaia'].includes(positional[0].toLowerCase())) {
    recipient = positional[0].toLowerCase();
    if (positional.length >= 3 && VALID_TYPES.includes(positional[1])) {
      type = positional[1];
      subject = positional[2];
      body = positional.slice(3).join(' ');
    } else {
      type = 'heads-up';
      subject = positional[1] || '';
      body = positional.slice(2).join(' ');
    }
  } else if (VALID_TYPES.includes(positional[0])) {
    recipient = other ?? '';
    type = positional[0];
    subject = positional[1] || '';
    body = positional.slice(2).join(' ');
  } else {
    recipient = other ?? '';
    type = 'heads-up';
    subject = positional[0];
    body = positional.slice(1).join(' ');
  }

  if (!recipient) {
    console.error('Cannot auto-detect recipient. Specify kaia or mike.');
    await redis.quit();
    process.exit(1);
  }

  if (!subject) {
    console.error('Subject is required.');
    await redis.quit();
    process.exit(1);
  }

  if (recipient === identity) {
    console.error(`Cannot send to yourself (${identity}).`);
    await redis.quit();
    process.exit(1);
  }

  const id = await redis.xadd(
    `claude:${recipient}:inbox`,
    '*',
    'from', identity,
    'type', type,
    'subject', subject,
    'body', body || '',
    'priority', priority,
    'gsdPhase', phase,
    'sentAt', new Date().toISOString()
  );

  console.log(`Message sent: ${id}`);
  console.log(`  To: ${recipient} | Type: ${type} | Priority: ${priority}`);
  console.log(`  Subject: ${subject}`);

  await redis.quit();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
