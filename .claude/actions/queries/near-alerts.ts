/**
 * Query Action: near-alerts
 *
 * Show symbols closest to MACD-V alert thresholds (+/-150, +/-200, +/-250).
 * Scans all indicator keys for an exchange and ranks by proximity to nearest threshold.
 *
 * Usage:
 *   npx tsx .claude/actions/queries/near-alerts.ts                    # all exchanges
 *   npx tsx .claude/actions/queries/near-alerts.ts --exchange 2       # Binance only
 *   npx tsx .claude/actions/queries/near-alerts.ts --top 10           # top 10 closest (default 15)
 *   npx tsx .claude/actions/queries/near-alerts.ts --timeframe 1h     # filter by timeframe
 */
import { getRedisClient } from '@livermore/cache';

const EXCHANGES: Record<number, string> = { 1: 'Coinbase', 2: 'Binance', 3: 'BinanceUS', 4: 'Kraken' };
const THRESHOLDS = [-250, -200, -150, 150, 200, 250];

interface NearAlert {
  exchange: string;
  exchangeId: number;
  symbol: string;
  timeframe: string;
  macdV: number;
  nearestThreshold: number;
  distance: number;
  direction: string;
  stage: string;
}

async function scanExchange(redis: ReturnType<typeof getRedisClient>, exchangeId: number, timeframeFilter: string | null): Promise<NearAlert[]> {
  const name = EXCHANGES[exchangeId];
  const pattern = `indicator:${exchangeId}:*:*:macd-v`;
  const keys = await redis.keys(pattern);

  if (keys.length === 0) return [];

  const results: NearAlert[] = [];

  for (const key of keys) {
    const parts = key.split(':');
    const symbol = parts[2];
    const timeframe = parts[3];

    if (timeframeFilter && timeframe !== timeframeFilter) continue;

    const raw = await redis.get(key);
    if (!raw) continue;

    try {
      const data = JSON.parse(raw);
      const macdV = data.value?.macdV;
      if (macdV === undefined || macdV === null || Number.isNaN(macdV)) continue;

      // Find nearest threshold and distance
      let nearestThreshold = THRESHOLDS[0];
      let minDistance = Math.abs(macdV - THRESHOLDS[0]);

      for (const t of THRESHOLDS) {
        const d = Math.abs(macdV - t);
        if (d < minDistance) {
          minDistance = d;
          nearestThreshold = t;
        }
      }

      // Direction: are we approaching from inside or already past?
      let direction: string;
      if (nearestThreshold < 0) {
        direction = macdV < nearestThreshold ? 'PAST' : 'approaching';
      } else {
        direction = macdV > nearestThreshold ? 'PAST' : 'approaching';
      }

      results.push({
        exchange: name,
        exchangeId,
        symbol,
        timeframe,
        macdV,
        nearestThreshold,
        distance: minDistance,
        direction,
        stage: data.params?.stage ?? 'unknown',
      });
    } catch {
      // skip unparseable
    }
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);

  let exchangeId: number | null = null;
  let top = 15;
  let timeframeFilter: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exchange' && args[i + 1]) {
      exchangeId = parseInt(args[++i], 10);
    } else if (args[i] === '--top' && args[i + 1]) {
      top = parseInt(args[++i], 10) || 15;
    } else if (args[i] === '--timeframe' && args[i + 1]) {
      timeframeFilter = args[++i];
    }
  }

  const redis = getRedisClient();

  const exchangeIds = exchangeId ? [exchangeId] : Object.keys(EXCHANGES).map(Number);
  let allResults: NearAlert[] = [];

  for (const eid of exchangeIds) {
    const results = await scanExchange(redis, eid, timeframeFilter);
    allResults = allResults.concat(results);
  }

  // Sort by distance to nearest threshold (closest first)
  allResults.sort((a, b) => a.distance - b.distance);

  const filtered = allResults.slice(0, top);

  console.log(`=== NEAREST TO ALERT THRESHOLDS${exchangeId ? ` (${EXCHANGES[exchangeId]})` : ' (all exchanges)'}${timeframeFilter ? ` [${timeframeFilter}]` : ''} ===`);
  console.log(`Scanned: ${allResults.length} indicator values | Showing top ${top}\n`);

  if (filtered.length === 0) {
    console.log('No indicator data found.');
    await redis.quit();
    process.exit(0);
  }

  // Count how many are past a threshold
  const pastCount = allResults.filter(r => r.direction === 'PAST').length;
  if (pastCount > 0) {
    console.log(`*** ${pastCount} symbol/timeframe combos currently PAST a threshold ***\n`);
  }

  // Header
  console.log('Exchange   | Symbol       | TF   | MACD-V   | Nearest  | Distance | Status      | Stage');
  console.log('-----------|--------------|------|----------|----------|----------|-------------|----------');

  for (const r of filtered) {
    const ex = r.exchange.padEnd(10);
    const sym = r.symbol.padEnd(12);
    const tf = r.timeframe.padEnd(4);
    const mv = r.macdV.toFixed(2).padStart(8);
    const nt = String(r.nearestThreshold).padStart(8);
    const dist = r.distance.toFixed(2).padStart(8);
    const status = r.direction.padEnd(11);
    console.log(`${ex} | ${sym} | ${tf} | ${mv} | ${nt} | ${dist} | ${status} | ${r.stage}`);
  }

  await redis.quit();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
