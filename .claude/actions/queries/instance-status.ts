/**
 * Query Action: instance-status
 *
 * Check if an exchange instance is running, its state, and recent activity.
 *
 * Usage:
 *   npx tsx .claude/actions/queries/instance-status.ts                # all instances
 *   npx tsx .claude/actions/queries/instance-status.ts --exchange 2   # Binance only
 *   npx tsx .claude/actions/queries/instance-status.ts --name binance # by name
 */
import { getRedisClient } from '@livermore/cache';
import { hostname } from 'node:os';

const EXCHANGES: Record<number, string> = { 1: 'Coinbase', 2: 'Binance', 3: 'BinanceUS', 4: 'Kraken' };

async function checkInstance(redis: ReturnType<typeof getRedisClient>, id: number, name: string) {
  console.log(`--- ${name} (exchangeId=${id}) ---`);

  const statusRaw = await redis.get(`exchange:${id}:status`);
  if (!statusRaw) {
    console.log('Status: NO KEY (instance not registered or TTL expired)');
    console.log('');
    return;
  }

  const s = JSON.parse(statusRaw);
  console.log(`State: ${s.connectionState ?? 'unknown'}`);
  console.log(`Registered: ${s.registeredAt ?? 'n/a'}`);
  console.log(`Connected: ${s.connectedAt ?? 'n/a'}`);
  console.log(`Last Heartbeat: ${s.lastHeartbeat ?? 'n/a'}`);
  console.log(`Last State Change: ${s.lastStateChange ?? 'n/a'}`);
  console.log(`Hostname: ${s.hostname ?? 'n/a'}`);
  console.log(`Symbols: ${s.symbolCount ?? 'n/a'}`);
  if (s.lastError) console.log(`Last Error: ${s.lastError}`);

  // Check activity stream
  const streamKey = `logs:network:${name.toLowerCase()}`;
  const recent = await redis.xrevrange(streamKey, '+', '-', 'COUNT', 3);
  if (recent && recent.length > 0) {
    console.log(`Recent activity (${streamKey}):`);
    for (const [entryId, fields] of recent) {
      const msg: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) msg[fields[i]] = fields[i + 1];
      const summary = msg.event || msg.state || JSON.stringify(msg);
      console.log(`  ${entryId}: ${summary}`);
    }
  }
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);

  let exchangeId: number | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exchange' && args[i + 1]) {
      exchangeId = parseInt(args[++i], 10);
    } else if (args[i] === '--name' && args[i + 1]) {
      const name = args[++i].toLowerCase();
      const entry = Object.entries(EXCHANGES).find(([, v]) => v.toLowerCase() === name);
      if (entry) exchangeId = parseInt(entry[0], 10);
      else { console.error(`Unknown exchange: ${name}`); process.exit(1); }
    }
  }

  const redis = getRedisClient();

  console.log('=== INSTANCE STATUS ===\n');

  if (exchangeId) {
    const name = EXCHANGES[exchangeId] ?? `Exchange ${exchangeId}`;
    await checkInstance(redis, exchangeId, name);
  } else {
    for (const [id, name] of Object.entries(EXCHANGES)) {
      await checkInstance(redis, parseInt(id, 10), name);
    }
  }

  await redis.quit();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
