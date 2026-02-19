/**
 * Claude Network Action: state
 *
 * Update own session state in Redis.
 *
 * Usage:
 *   npx tsx .claude/actions/claude-net/state.ts --work "Current task"
 *   npx tsx .claude/actions/claude-net/state.ts --work "Task" --changes "Change 1" "Change 2"
 *   npx tsx .claude/actions/claude-net/state.ts --observe coinbase active
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

interface SessionState {
  lastSession: string;
  currentWork: string;
  recentChanges: string[];
  instanceObservations: Record<string, { state: string; at: string }>;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  state.ts --work "description"');
    console.error('  state.ts --changes "change1" "change2" ...');
    console.error('  state.ts --observe <exchange> <state>');
    process.exit(1);
  }

  // Parse args
  let work: string | null = null;
  let changes: string[] | null = null;
  let observeExchange: string | null = null;
  let observeState: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--work' && args[i + 1]) {
      work = args[++i];
    } else if (args[i] === '--changes') {
      changes = [];
      // Collect all remaining non-flag args
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        changes.push(args[i]);
        i++;
      }
      i--; // back up one for the loop increment
    } else if (args[i] === '--observe' && args[i + 1] && args[i + 2]) {
      observeExchange = args[++i];
      observeState = args[++i];
    }
  }

  const redis = getRedisClient();
  const identity = await getIdentity(redis);
  const stateKey = `claude:${identity}:state`;

  // Read existing state
  const existingRaw = await redis.get(stateKey);
  const existing: SessionState = existingRaw
    ? JSON.parse(existingRaw)
    : { lastSession: '', currentWork: '', recentChanges: [], instanceObservations: {} };

  // Merge updates
  const updated: SessionState = {
    lastSession: new Date().toISOString(),
    currentWork: work ?? existing.currentWork,
    recentChanges: changes ?? existing.recentChanges,
    instanceObservations: { ...existing.instanceObservations },
  };

  if (observeExchange && observeState) {
    updated.instanceObservations[observeExchange] = {
      state: observeState,
      at: new Date().toISOString(),
    };
  }

  await redis.set(stateKey, JSON.stringify(updated));

  console.log(`State updated: claude:${identity}:state`);
  if (work) console.log(`  Work: ${work}`);
  if (changes) console.log(`  Changes: ${changes.length} entries`);
  if (observeExchange) console.log(`  Observe: ${observeExchange} → ${observeState}`);

  await redis.quit();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
