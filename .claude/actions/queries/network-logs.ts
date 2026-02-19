/**
 * Query Action: network-logs
 *
 * Show network activity logs from Redis streams (logs:network:*).
 * Each exchange has its own stream tracking state transitions and errors.
 *
 * Usage:
 *   npx tsx .claude/actions/queries/network-logs.ts                    # all exchanges, last 5 per stream
 *   npx tsx .claude/actions/queries/network-logs.ts --exchange binance  # single exchange
 *   npx tsx .claude/actions/queries/network-logs.ts --count 20          # more entries per stream
 *   npx tsx .claude/actions/queries/network-logs.ts --errors            # errors only
 */
import { getRedisClient } from '@livermore/cache';

async function main() {
  const args = process.argv.slice(2);

  let filterExchange: string | null = null;
  let count = 5;
  let errorsOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exchange' && args[i + 1]) {
      filterExchange = args[++i].toLowerCase();
    } else if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[++i], 10) || 5;
    } else if (args[i] === '--errors') {
      errorsOnly = true;
    }
  }

  const redis = getRedisClient();

  const allKeys = await redis.keys('logs:network:*');
  const keys = filterExchange
    ? allKeys.filter(k => k.includes(filterExchange!))
    : allKeys.sort();

  console.log(`=== NETWORK LOGS${filterExchange ? ` (${filterExchange})` : ''} ===\n`);
  console.log(`Log streams found: ${keys.length}`);

  for (const k of keys) {
    const totalLen = await redis.xlen(k);
    const entries: [string, string[]][] = await redis.xrevrange(k, '+', '-', 'COUNT', String(count * (errorsOnly ? 5 : 1))) as any;

    const exchange = k.replace('logs:network:', '');

    const parsed = entries.map(([id, fields]) => {
      const ts = new Date(parseInt(id.split('-')[0])).toISOString();
      const data: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        data[fields[i]] = fields[i + 1];
      }
      return { id, ts, data };
    });

    const filtered = errorsOnly ? parsed.filter(e => e.data.event === 'error') : parsed;
    const display = filtered.slice(0, count);

    console.log(`\n--- ${exchange} (${totalLen} total) ---`);

    if (display.length === 0) {
      console.log('  No matching entries.');
      continue;
    }

    for (const e of display) {
      const { event, timestamp, ...rest } = e.data;
      const parts: string[] = [];

      if (event === 'state_transition') {
        parts.push(`${rest.fromState} → ${rest.toState}`);
        if (rest.hostname) parts.push(`host=${rest.hostname}`);
      } else if (event === 'error') {
        parts.push(`ERROR: ${rest.error}`);
        if (rest.state) parts.push(`state=${rest.state}`);
        if (rest.hostname) parts.push(`host=${rest.hostname}`);
      } else {
        parts.push(event || '?');
        for (const [k, v] of Object.entries(rest)) {
          parts.push(`${k}=${v}`);
        }
      }

      console.log(`  ${e.ts}  ${parts.join(' | ')}`);
    }
  }

  await redis.quit();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
