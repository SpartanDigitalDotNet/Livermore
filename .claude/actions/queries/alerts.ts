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
 *   npx tsx .claude/actions/queries/alerts.ts --summary              # count breakdown by symbol/type
 *   npx tsx .claude/actions/queries/alerts.ts --exchange 2 --summary # Binance summary
 */
import { getDbClient, alertHistory } from '@livermore/database';
import { eq, and, desc, gte, count as countFn } from 'drizzle-orm';

async function main() {
  const args = process.argv.slice(2);

  let exchangeId: number | null = null;
  let symbol: string | null = null;
  let alertType: string | null = null;
  let count = 20;
  let since: string | null = null;
  let summary = false;

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
    } else if (args[i] === '--summary') {
      summary = true;
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

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build filter description
  const filters = [];
  if (exchangeId) filters.push(`exchange=${exchangeId}`);
  if (symbol) filters.push(`symbol=${symbol}`);
  if (alertType) filters.push(`type=${alertType}`);
  if (sinceDate) filters.push(`since=${sinceDate.toISOString()}`);
  const filterStr = filters.length > 0 ? ` (${filters.join(', ')})` : '';

  if (summary) {
    // Summary mode: count breakdowns
    const totalResult = await db
      .select({ count: countFn() })
      .from(alertHistory)
      .where(whereClause);
    const total = totalResult[0].count;

    console.log(`=== ALERT SUMMARY${filterStr} ===`);
    console.log(`Total: ${total} alert(s)\n`);

    if (total === 0) {
      process.exit(0);
    }

    // By Symbol
    const bySymbol = await db
      .select({ symbol: alertHistory.symbol, count: countFn() })
      .from(alertHistory)
      .where(whereClause)
      .groupBy(alertHistory.symbol)
      .orderBy(desc(countFn()));

    console.log('By Symbol:');
    for (const row of bySymbol) {
      console.log(`  ${row.symbol.padEnd(16)} ${row.count}`);
    }

    // By Type
    const byType = await db
      .select({ alertType: alertHistory.alertType, count: countFn() })
      .from(alertHistory)
      .where(whereClause)
      .groupBy(alertHistory.alertType)
      .orderBy(desc(countFn()));

    console.log('\nBy Type:');
    for (const row of byType) {
      console.log(`  ${row.alertType.padEnd(16)} ${row.count}`);
    }

    // By Exchange (only if not filtered to a single exchange)
    if (!exchangeId) {
      const byExchange = await db
        .select({ exchangeId: alertHistory.exchangeId, count: countFn() })
        .from(alertHistory)
        .where(whereClause)
        .groupBy(alertHistory.exchangeId)
        .orderBy(desc(countFn()));

      const exchangeNames: Record<number, string> = { 1: 'Coinbase', 2: 'Binance', 3: 'BinanceUS', 4: 'Kraken' };
      console.log('\nBy Exchange:');
      for (const row of byExchange) {
        const name = exchangeNames[row.exchangeId] ?? `Exchange ${row.exchangeId}`;
        console.log(`  ${name.padEnd(16)} ${row.count}`);
      }
    }

    process.exit(0);
  }

  // Default mode: list individual alerts
  const results = await db
    .select()
    .from(alertHistory)
    .where(whereClause)
    .orderBy(desc(alertHistory.triggeredAt))
    .limit(count);

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
