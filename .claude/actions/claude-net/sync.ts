/**
 * Claude Network Action: sync
 *
 * Full boot sync — read shared knowledge, own state, and new inbox messages.
 *
 * Usage:
 *   npx tsx .claude/actions/claude-net/sync.ts              # full sync
 *   npx tsx .claude/actions/claude-net/sync.ts --inbox-only  # just check inbox
 *   npx tsx .claude/actions/claude-net/sync.ts --no-ack      # don't mark messages as read
 */
import { getRedisClient } from '@livermore/cache';
import { hostname } from 'node:os';

type RedisClient = ReturnType<typeof getRedisClient>;

async function getIdentityAndShared(redis: RedisClient) {
  const host = hostname();
  const sharedRaw = await redis.get('claude:shared');
  if (!sharedRaw) throw new Error('claude:shared key not found in Redis');
  const shared = JSON.parse(sharedRaw);
  const identity = shared?.architecture?.hosts?.[host]?.toLowerCase();
  if (!identity) throw new Error(`Unknown host: ${host}. Known: ${JSON.stringify(shared?.architecture?.hosts)}`);
  return { identity: identity as string, shared, host };
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
  const inboxOnly = args.includes('--inbox-only');
  const noAck = args.includes('--no-ack');

  const redis = getRedisClient();
  const { identity, shared, host } = await getIdentityAndShared(redis);

  console.log(`=== CLAUDE SYNC BOOT ===`);
  console.log(`Identity: ${identity} (${host})`);
  console.log('');

  if (!inboxOnly) {
    // Step 1: Shared knowledge
    const gotchas = shared?.gotchas || [];
    console.log(`=== SHARED KNOWLEDGE ===`);
    console.log(`Last updated: ${shared?.lastUpdated || 'unknown'} by ${shared?.updatedBy || 'unknown'}`);
    console.log(`Gotchas: ${gotchas.length}`);
    for (const g of gotchas) {
      console.log(`  - [${g.by}] ${g.text}`);
    }
    console.log(`Exchanges: ${JSON.stringify(shared?.architecture?.exchanges)}`);
    console.log('');

    // Step 2: Own state
    const stateRaw = await redis.get(`claude:${identity}:state`);
    console.log(`=== OWN STATE (claude:${identity}:state) ===`);
    if (stateRaw) {
      const state = JSON.parse(stateRaw);
      console.log(`Last session: ${state?.lastSession || 'unknown'}`);
      console.log(`Current work: ${state?.currentWork || 'none'}`);
      if (state?.recentChanges?.length) {
        console.log(`Recent changes:`);
        for (const c of state.recentChanges) {
          console.log(`  - ${c}`);
        }
      }
      if (state?.instanceObservations) {
        console.log(`Instance observations:`);
        for (const [ex, obs] of Object.entries(state.instanceObservations)) {
          const o = obs as any;
          console.log(`  - ${ex}: ${o.state} (at ${o.at})`);
        }
      }
    } else {
      console.log('No state found — first boot for this identity.');
    }
    console.log('');
  }

  // Step 3: Inbox
  const inboxKey = `claude:${identity}:inbox`;
  await ensureConsumerGroup(redis, inboxKey);

  const results = await redis.xreadgroup(
    'GROUP', 'readers', identity,
    'COUNT', 100, 'STREAMS', inboxKey, '>'
  );

  const newMessages = results?.[0]?.[1] ?? [];

  console.log(`=== INBOX (claude:${identity}:inbox) ===`);
  if (newMessages.length === 0) {
    console.log('No new messages.');
  } else {
    let urgentCount = 0;
    const messageIds: string[] = [];

    console.log(`${newMessages.length} new message(s):`);
    for (const [id, fields] of newMessages) {
      messageIds.push(id);
      const msg: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        msg[fields[i]] = fields[i + 1];
      }
      if (msg.priority === 'urgent') urgentCount++;
      const urgent = msg.priority === 'urgent' ? ' [URGENT]' : '';
      console.log(`\n--- [NEW] ${id}${urgent} ---`);
      console.log(`From: ${msg.from} | Type: ${msg.type} | Sent: ${msg.sentAt}`);
      console.log(`Subject: ${msg.subject}`);
      console.log(`Body:\n${msg.body}`);
    }

    if (!noAck && messageIds.length > 0) {
      await redis.xack(inboxKey, 'readers', ...messageIds);
      console.log(`\nACKed ${messageIds.length} message(s)`);
    } else if (noAck) {
      console.log(`\n(no-ack mode — messages NOT marked as read)`);
    }

    if (urgentCount > 0) {
      console.log(`\n*** ${urgentCount} URGENT message(s) ***`);
    }
  }

  const totalMessages = await redis.xlen(inboxKey);
  console.log('');
  console.log(`=== SUMMARY ===`);
  console.log(`Identity: ${identity}`);
  if (!inboxOnly) {
    console.log(`Shared knowledge: ${shared?.gotchas?.length || 0} gotchas`);
  }
  console.log(`Inbox: ${newMessages.length} new / ${totalMessages} total`);

  await redis.quit();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
