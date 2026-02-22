/**
 * Refresh Symbol Universe
 *
 * Runs the SymbolRefreshService to update exchange_symbols from CoinGecko + exchange products.
 *
 * Usage:
 *   npx tsx .claude/actions/queries/refresh-symbols.ts [--exchange <id>] [--limit <n>]
 *
 * Options:
 *   --exchange <id>  Refresh only this exchange (default: all non-geo-restricted)
 *   --limit <n>      Top N coins from CoinGecko (default: 100)
 *
 * Examples:
 *   npx tsx .claude/actions/queries/refresh-symbols.ts                     # All exchanges, top 100
 *   npx tsx .claude/actions/queries/refresh-symbols.ts --exchange 1        # Coinbase only
 *   npx tsx .claude/actions/queries/refresh-symbols.ts --exchange 1 --limit 50  # Coinbase, top 50
 */
import { SymbolRefreshService } from '../../../../apps/api/src/services/symbol-refresh.service';
import { getDbClient, exchangeSymbols } from '@livermore/database';
import { eq, and, lte, isNotNull } from 'drizzle-orm';

function parseArgs() {
  const args = process.argv.slice(2);
  let exchangeId: number | undefined;
  let limit = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exchange' && args[i + 1]) {
      exchangeId = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { exchangeId, limit };
}

async function main() {
  const { exchangeId, limit } = parseArgs();

  const target = exchangeId ? `exchange ${exchangeId}` : 'all exchanges';
  console.log(`Refreshing symbols: top ${limit} coins, ${target}\n`);

  const service = new SymbolRefreshService();
  const result = await service.refresh(limit, exchangeId);

  console.log('=== Refresh Summary ===');
  console.log(`  Added:       ${result.added}`);
  console.log(`  Updated:     ${result.updated}`);
  console.log(`  Deactivated: ${result.deactivated}`);
  console.log(`  Timestamp:   ${result.timestamp}`);

  if (Object.keys(result.perExchange).length > 1) {
    console.log('\nPer-exchange:');
    for (const [name, stats] of Object.entries(result.perExchange)) {
      console.log(`  ${name}: +${stats.added} updated=${stats.updated} deactivated=${stats.deactivated}`);
    }
  }

  // Show top 10 symbols by rank for verification
  if (exchangeId) {
    const db = getDbClient();
    const top10 = await db
      .select({
        symbol: exchangeSymbols.symbol,
        globalRank: exchangeSymbols.globalRank,
        liquidityScore: exchangeSymbols.liquidityScore,
      })
      .from(exchangeSymbols)
      .where(
        and(
          eq(exchangeSymbols.exchangeId, exchangeId),
          eq(exchangeSymbols.isActive, true),
          isNotNull(exchangeSymbols.globalRank),
          lte(exchangeSymbols.globalRank, 10)
        )
      )
      .orderBy(exchangeSymbols.globalRank);

    console.log('\nTop 10 by rank:');
    for (const s of top10) {
      console.log(`  #${s.globalRank} ${s.symbol} (score=${s.liquidityScore})`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
