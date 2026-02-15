/**
 * Query Action: alerts
 *
 * Query alert history from the database, filtered by exchange, symbol, type.
 *
 * Usage:
 *   npx tsx .claude/actions/queries/alerts.ts                        # all alerts, last 20
 *   npx tsx .claude/actions/queries/alerts.ts --exchange 2           # Binance alerts
 *   npx tsx .claude/actions/queries/alerts.ts --symbol BTC-USD       # BTC alerts
 *   npx tsx .claude/actions/queries/alerts.ts --type macdv           # MACDV alerts only
 *   npx tsx .claude/actions/queries/alerts.ts --count 50             # last 50
 *   npx tsx .claude/actions/queries/alerts.ts --since today          # today's alerts
 *   npx tsx .claude/actions/queries/alerts.ts --since 2h             # last 2 hours
 */
import { getDbClient, alertHistory } from '@livermore/database';
import { eq, and, desc, gte } from 'drizzle-orm';

async function main() {
  const args = process.argv.slice(2);

  let exchangeId: number | null = null;
  let symbol: string | null = null;
  let alertType: string | null = null;
  let count = 20;
  let since: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exchange' && args[i + 1]) {
      exchangeId = parseInt(args[++i], 10);
    } else if (args[i] === '--symbol' && args[i + 1]) {
      symbol = args[++i];
    } else if (args[i] === '--type' && args[i + 1]) {
      alertType = args[++i];
    } else if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[++i], 10) || 20;
    } else if (args[i] === '--since' && args[i + 1]) {
      since = args[++i];
    }
  }

  const db = getDbClient();

  // Parse --since into a Date
  let sinceDate: Date | null = null;
  if (since) {
    if (since === 'today') {
      sinceDate = new Date();
      sinceDate.setHours(0, 0, 0, 0);
    } else if (/^\d+h$/.test(since)) {
      sinceDate = new Date(Date.now() - parseInt(since) * 3600000);
    } else if (/^\d+d$/.test(since)) {
      sinceDate = new Date(Date.now() - parseInt(since) * 86400000);
    } else if (/^\d+m$/.test(since)) {
      sinceDate = new Date(Date.now() - parseInt(since) * 60000);
    }
  }

  const conditions = [];
  if (exchangeId) conditions.push(eq(alertHistory.exchangeId, exchangeId));
  if (symbol) conditions.push(eq(alertHistory.symbol, symbol));
  if (alertType) conditions.push(eq(alertHistory.alertType, alertType));
  if (sinceDate) conditions.push(gte(alertHistory.triggeredAt, sinceDate));

  const results = await db
    .select()
    .from(alertHistory)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alertHistory.triggeredAt))
    .limit(count);

  // Build filter description
  const filters = [];
  if (exchangeId) filters.push(`exchange=${exchangeId}`);
  if (symbol) filters.push(`symbol=${symbol}`);
  if (alertType) filters.push(`type=${alertType}`);
  if (sinceDate) filters.push(`since=${sinceDate.toISOString()}`);
  const filterStr = filters.length > 0 ? ` (${filters.join(', ')})` : '';

  console.log(`=== ALERT HISTORY${filterStr} ===`);
  console.log(`Found: ${results.length} alert(s)\n`);

  for (const r of results) {
    console.log(`${r.triggeredAt} | ex=${r.exchangeId} | ${r.symbol} | ${r.alertType} | ${r.triggerLabel} | price=${r.price}`);
  }

  if (results.length === 0) {
    console.log('No alerts found.');
  }

  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
