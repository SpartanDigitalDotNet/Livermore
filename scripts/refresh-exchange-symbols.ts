/**
 * Refresh exchange symbols via CoinGecko + exchange product APIs
 *
 * Usage:
 *   npx tsx scripts/refresh-exchange-symbols.ts                    # all non-geo-restricted
 *   npx tsx scripts/refresh-exchange-symbols.ts --exchange-id 2    # specific exchange
 */
import 'dotenv/config';

import { SymbolRefreshService } from '../apps/api/src/services/symbol-refresh.service';

function parseArgs(): { exchangeId?: number } {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--exchange-id');
  if (idx !== -1 && args[idx + 1]) {
    const id = parseInt(args[idx + 1], 10);
    if (isNaN(id) || id <= 0) {
      console.error('Error: --exchange-id must be a positive integer');
      process.exit(1);
    }
    return { exchangeId: id };
  }
  return {};
}

async function main() {
  const { exchangeId } = parseArgs();

  console.log('=== Refresh Exchange Symbols ===\n');
  if (exchangeId) {
    console.log(`Refreshing exchange_id=${exchangeId} only`);
  } else {
    console.log('Refreshing all non-geo-restricted exchanges (parallel)');
  }
  console.log('Fetching top 100 coins from CoinGecko...\n');

  const service = new SymbolRefreshService();
  const summary = await service.refresh(100, exchangeId);

  console.log('\n=== Refresh Summary ===');
  console.log(`  Added:       ${summary.added}`);
  console.log(`  Updated:     ${summary.updated}`);
  console.log(`  Deactivated: ${summary.deactivated}`);
  console.log(`  Timestamp:   ${summary.timestamp}`);
  console.log('\nPer Exchange:');
  for (const [exchange, stats] of Object.entries(summary.perExchange)) {
    console.log(`  ${exchange}: +${stats.added} updated=${stats.updated} deactivated=${stats.deactivated}`);
  }

  console.log('\nDone!');
  process.exit(0);
}

main().catch((error) => {
  console.error('Failed to refresh exchange symbols:', error);
  process.exit(1);
});
