/**
 * Query Action: arb-signals
 *
 * Cross-exchange arbitrage signal analysis using alert_history.
 * Finds overlapping symbols across exchanges, compares alert timing,
 * and calculates theoretical P&L from acting on the leading signal.
 *
 * Usage:
 *   npx tsx .claude/actions/queries/arb-signals.ts                        # all pairs, last 24h
 *   npx tsx .claude/actions/queries/arb-signals.ts --since 2h             # last 2 hours
 *   npx tsx .claude/actions/queries/arb-signals.ts --since today          # today only
 *   npx tsx .claude/actions/queries/arb-signals.ts --symbol MORPHO        # specific base currency
 *   npx tsx .claude/actions/queries/arb-signals.ts --min-delta 5          # min 5 min lead time
 *   npx tsx .claude/actions/queries/arb-signals.ts --type level           # only level alerts (not reversals)
 *   npx tsx .claude/actions/queries/arb-signals.ts --exchanges 1,2        # only Coinbase vs Binance
 */
import { getDbClient, alertHistory, exchangeSymbols } from '@livermore/database';
import { eq, and, desc, gte, inArray } from 'drizzle-orm';

// Exchange name map
const EXCHANGE_NAMES: Record<number, string> = {
  1: 'Coinbase',
  2: 'Binance',
  3: 'Binance.US',
};

/**
 * Normalize a symbol to its base currency for cross-exchange matching.
 * BTC-USD → BTC, BTCUSD → BTC, BTCUSDT → BTC
 */
function toBaseCurrency(symbol: string): string {
  // Remove known quote suffixes
  return symbol
    .replace(/-USD$/, '')
    .replace(/USDT$/, '')
    .replace(/USD$/, '');
}

/**
 * Extract alert level number from triggerLabel.
 * "level_-150" → -150, "level_200" → 200, "reversal_oversold" → null
 */
function extractLevel(label: string): number | null {
  const match = label.match(/^level_(-?\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

interface AlertRow {
  id: number;
  exchangeId: number;
  symbol: string;
  timeframe: string | null;
  alertType: string;
  triggeredAtEpoch: number;
  triggeredAt: Date;
  price: string;
  triggerValue: string | null;
  triggerLabel: string;
  previousLabel: string | null;
  details: unknown;
  notificationSent: boolean;
  notificationError: string | null;
}

interface ArbOpportunity {
  baseCurrency: string;
  leaderExchange: number;
  leaderSymbol: string;
  leaderAlert: AlertRow;
  followerExchange: number;
  followerSymbol: string;
  followerAlert: AlertRow;
  leadTimeMinutes: number;
  leaderPrice: number;
  followerPrice: number;
  /** Price at follower exchange when leader alerted (if available) */
  followerPriceAtLeaderTime: number | null;
  /** If you shorted at follower exchange when leader signaled → P&L vs follower's own alert price */
  theoreticalPnlPct: number | null;
}

async function main() {
  const args = process.argv.slice(2);

  let since: string | null = '24h';
  let symbolFilter: string | null = null;
  let minDelta = 0; // minimum lead time in minutes
  let typeFilter: string | null = null;
  let exchangeFilter: number[] = []; // only these exchanges (empty = all)

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since' && args[i + 1]) {
      since = args[++i];
    } else if (args[i] === '--symbol' && args[i + 1]) {
      symbolFilter = args[++i].toUpperCase();
    } else if (args[i] === '--min-delta' && args[i + 1]) {
      minDelta = parseInt(args[++i], 10) || 0;
    } else if (args[i] === '--type' && args[i + 1]) {
      typeFilter = args[++i].toLowerCase();
    } else if (args[i] === '--exchanges' && args[i + 1]) {
      exchangeFilter = args[++i].split(',').map(s => parseInt(s.trim(), 10));
    }
  }

  const db = getDbClient();

  // Parse --since into a Date
  let sinceDate: Date;
  if (since === 'today') {
    sinceDate = new Date();
    sinceDate.setHours(0, 0, 0, 0);
  } else if (/^\d+h$/.test(since!)) {
    sinceDate = new Date(Date.now() - parseInt(since!) * 3600000);
  } else if (/^\d+d$/.test(since!)) {
    sinceDate = new Date(Date.now() - parseInt(since!) * 86400000);
  } else if (/^\d+m$/.test(since!)) {
    sinceDate = new Date(Date.now() - parseInt(since!) * 60000);
  } else {
    sinceDate = new Date(Date.now() - 24 * 3600000); // default 24h
  }

  // Fetch all alerts in the time window
  const conditions = [gte(alertHistory.triggeredAt, sinceDate)];
  if (typeFilter === 'level') {
    // Only level alerts (filter out reversals)
    // We'll filter in-memory since we need LIKE matching
  }

  const allAlerts = await db
    .select()
    .from(alertHistory)
    .where(and(...conditions))
    .orderBy(desc(alertHistory.triggeredAt));

  // Group alerts by base currency → exchange → alerts[]
  const byBase = new Map<string, Map<number, AlertRow[]>>();

  for (const alert of allAlerts) {
    // Apply exchange filter
    if (exchangeFilter.length > 0 && !exchangeFilter.includes(alert.exchangeId)) continue;

    // Apply type filter
    if (typeFilter === 'level' && !alert.triggerLabel.startsWith('level_')) continue;
    if (typeFilter === 'reversal' && !alert.triggerLabel.startsWith('reversal_')) continue;

    const base = toBaseCurrency(alert.symbol);

    // Apply symbol filter
    if (symbolFilter && base !== symbolFilter) continue;

    if (!byBase.has(base)) byBase.set(base, new Map());
    const exchangeMap = byBase.get(base)!;
    if (!exchangeMap.has(alert.exchangeId)) exchangeMap.set(alert.exchangeId, []);
    exchangeMap.get(alert.exchangeId)!.push(alert as AlertRow);
  }

  // Find cross-exchange pairs (symbols present on 2+ exchanges)
  const opportunities: ArbOpportunity[] = [];

  for (const [base, exchangeMap] of byBase) {
    const exchangeIds = Array.from(exchangeMap.keys());
    if (exchangeIds.length < 2) continue;

    // Compare all exchange pairs
    for (let i = 0; i < exchangeIds.length; i++) {
      for (let j = i + 1; j < exchangeIds.length; j++) {
        const exA = exchangeIds[i];
        const exB = exchangeIds[j];
        const alertsA = exchangeMap.get(exA)!;
        const alertsB = exchangeMap.get(exB)!;

        // Match alerts by similar level thresholds
        // For each level alert on exchange A, find the matching level on exchange B
        const levelAlertsA = alertsA.filter(a => a.triggerLabel.startsWith('level_'));
        const levelAlertsB = alertsB.filter(a => a.triggerLabel.startsWith('level_'));

        for (const alertA of levelAlertsA) {
          const levelA = extractLevel(alertA.triggerLabel);
          if (levelA === null) continue;

          // Find matching level on exchange B
          const matchB = levelAlertsB.find(b => extractLevel(b.triggerLabel) === levelA);
          if (!matchB) continue;

          const timeA = alertA.triggeredAtEpoch;
          const timeB = matchB.triggeredAtEpoch;
          const deltaMs = timeB - timeA;
          const deltaMin = deltaMs / 60000;

          // Determine leader/follower
          let leader: AlertRow, follower: AlertRow, leaderEx: number, followerEx: number;
          if (deltaMs > 0) {
            // A was first
            leader = alertA;
            follower = matchB;
            leaderEx = exA;
            followerEx = exB;
          } else if (deltaMs < 0) {
            // B was first
            leader = matchB;
            follower = alertA;
            leaderEx = exB;
            followerEx = exA;
          } else {
            continue; // simultaneous, no edge
          }

          const leadTimeMin = Math.abs(deltaMin);
          if (leadTimeMin < minDelta) continue;

          const leaderPrice = parseFloat(leader.price);
          const followerPrice = parseFloat(follower.price);

          // Try to estimate follower exchange price at leader's alert time
          // Look for the closest alert on the follower exchange near the leader's time
          const followerAlerts = followerEx === exA ? alertsA : alertsB;
          let followerPriceAtLeaderTime: number | null = null;

          // Find any alert on follower exchange closest to leader's time
          const followerSameSymbol = followerAlerts
            .filter(a => parseFloat(a.price) > 0)
            .sort((a, b) => Math.abs(a.triggeredAtEpoch - leader.triggeredAtEpoch) - Math.abs(b.triggeredAtEpoch - leader.triggeredAtEpoch));

          if (followerSameSymbol.length > 0) {
            const closest = followerSameSymbol[0];
            const closestDeltaMin = Math.abs(closest.triggeredAtEpoch - leader.triggeredAtEpoch) / 60000;
            // Only use if within 10 minutes of leader alert
            if (closestDeltaMin <= 10) {
              followerPriceAtLeaderTime = parseFloat(closest.price);
            }
          }

          // Theoretical P&L: If the signal is bearish (negative level), you short.
          // Entry at follower price when leader signals → exit at follower's own alert price.
          let theoreticalPnlPct: number | null = null;
          if (followerPriceAtLeaderTime && followerPriceAtLeaderTime > 0 && followerPrice > 0) {
            if (levelA < 0) {
              // Bearish signal → short: profit = (entry - exit) / entry
              theoreticalPnlPct = ((followerPriceAtLeaderTime - followerPrice) / followerPriceAtLeaderTime) * 100;
            } else {
              // Bullish signal → long: profit = (exit - entry) / entry
              theoreticalPnlPct = ((followerPrice - followerPriceAtLeaderTime) / followerPriceAtLeaderTime) * 100;
            }
          }

          opportunities.push({
            baseCurrency: base,
            leaderExchange: leaderEx,
            leaderSymbol: leader.symbol,
            leaderAlert: leader,
            followerExchange: followerEx,
            followerSymbol: follower.symbol,
            followerAlert: follower,
            leadTimeMinutes: leadTimeMin,
            leaderPrice,
            followerPrice,
            followerPriceAtLeaderTime,
            theoreticalPnlPct,
          });
        }

        // Also match reversal alerts
        const reversalA = alertsA.filter(a => a.triggerLabel.startsWith('reversal_'));
        const reversalB = alertsB.filter(a => a.triggerLabel.startsWith('reversal_'));

        for (const revA of reversalA) {
          const matchRev = reversalB.find(b => b.triggerLabel === revA.triggerLabel);
          if (!matchRev) continue;

          const timeA = revA.triggeredAtEpoch;
          const timeB = matchRev.triggeredAtEpoch;
          const deltaMs = timeB - timeA;
          const deltaMin = deltaMs / 60000;

          let leader: AlertRow, follower: AlertRow, leaderEx: number, followerEx: number;
          if (deltaMs > 0) {
            leader = revA; follower = matchRev; leaderEx = exA; followerEx = exB;
          } else if (deltaMs < 0) {
            leader = matchRev; follower = revA; leaderEx = exB; followerEx = exA;
          } else {
            continue;
          }

          const leadTimeMin = Math.abs(deltaMin);
          if (leadTimeMin < minDelta) continue;

          opportunities.push({
            baseCurrency: base,
            leaderExchange: leaderEx,
            leaderSymbol: leader.symbol,
            leaderAlert: leader,
            followerExchange: followerEx,
            followerSymbol: follower.symbol,
            followerAlert: follower,
            leadTimeMinutes: leadTimeMin,
            leaderPrice: parseFloat(leader.price),
            followerPrice: parseFloat(follower.price),
            followerPriceAtLeaderTime: null, // harder to estimate for reversals
            theoreticalPnlPct: null,
          });
        }
      }
    }
  }

  // Sort by lead time descending (biggest edge first)
  opportunities.sort((a, b) => b.leadTimeMinutes - a.leadTimeMinutes);

  // Print results
  const filterParts = [];
  filterParts.push(`since=${sinceDate.toLocaleTimeString()}`);
  if (symbolFilter) filterParts.push(`symbol=${symbolFilter}`);
  if (minDelta) filterParts.push(`min-delta=${minDelta}m`);
  if (typeFilter) filterParts.push(`type=${typeFilter}`);
  if (exchangeFilter.length > 0) filterParts.push(`exchanges=${exchangeFilter.join(',')}`);

  console.log(`=== CROSS-EXCHANGE ARB SIGNALS (${filterParts.join(', ')}) ===`);
  console.log(`Total alerts scanned: ${allAlerts.length}`);
  console.log(`Symbols on 2+ exchanges: ${Array.from(byBase.entries()).filter(([_, m]) => m.size >= 2).map(([b]) => b).join(', ') || 'none'}`);
  console.log(`Arb opportunities found: ${opportunities.length}\n`);

  if (opportunities.length === 0) {
    console.log('No cross-exchange arb signals found in this time window.');
    console.log('Tips: Try --since 24h for a wider window, or wait for more alerts to accumulate.');
    process.exit(0);
  }

  for (const opp of opportunities) {
    const leaderName = EXCHANGE_NAMES[opp.leaderExchange] || `ex=${opp.leaderExchange}`;
    const followerName = EXCHANGE_NAMES[opp.followerExchange] || `ex=${opp.followerExchange}`;
    const direction = opp.leaderAlert.triggerLabel.startsWith('level_-') ? 'SHORT' :
                      opp.leaderAlert.triggerLabel.startsWith('level_') ? 'LONG' :
                      opp.leaderAlert.triggerLabel.includes('oversold') ? 'SHORT' : 'LONG';

    console.log(`--- ${opp.baseCurrency} | ${opp.leaderAlert.triggerLabel} | ${direction} ---`);
    console.log(`  Leader:   ${leaderName} (${opp.leaderSymbol}) @ ${new Date(opp.leaderAlert.triggeredAtEpoch).toLocaleTimeString()} | price=$${opp.leaderPrice}`);
    console.log(`  Follower: ${followerName} (${opp.followerSymbol}) @ ${new Date(opp.followerAlert.triggeredAtEpoch).toLocaleTimeString()} | price=$${opp.followerPrice}`);
    console.log(`  Lead time: ${opp.leadTimeMinutes.toFixed(1)} min`);

    if (opp.followerPriceAtLeaderTime !== null) {
      console.log(`  Follower price at leader signal: $${opp.followerPriceAtLeaderTime}`);
    }
    if (opp.theoreticalPnlPct !== null) {
      const sign = opp.theoreticalPnlPct >= 0 ? '+' : '';
      console.log(`  Theoretical P&L: ${sign}${opp.theoreticalPnlPct.toFixed(3)}%`);
    }
    console.log('');
  }

  // Summary stats
  const withPnl = opportunities.filter(o => o.theoreticalPnlPct !== null);
  if (withPnl.length > 0) {
    const avgPnl = withPnl.reduce((sum, o) => sum + o.theoreticalPnlPct!, 0) / withPnl.length;
    const profitable = withPnl.filter(o => o.theoreticalPnlPct! > 0);
    const avgLead = opportunities.reduce((sum, o) => sum + o.leadTimeMinutes, 0) / opportunities.length;

    console.log('=== SUMMARY ===');
    console.log(`Total signals: ${opportunities.length}`);
    console.log(`With P&L data: ${withPnl.length}`);
    console.log(`Profitable: ${profitable.length}/${withPnl.length} (${((profitable.length / withPnl.length) * 100).toFixed(0)}%)`);
    console.log(`Avg P&L: ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(3)}%`);
    console.log(`Avg lead time: ${avgLead.toFixed(1)} min`);
    console.log(`Best lead time: ${Math.max(...opportunities.map(o => o.leadTimeMinutes)).toFixed(1)} min`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
