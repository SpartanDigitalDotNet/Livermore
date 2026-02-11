/**
 * Seed exchange_symbols table via CoinGecko + exchange product APIs
 *
 * Run: npx tsx scripts/seed-exchange-symbols.ts
 *
 * Uses the same SymbolRefreshService as the Admin UI "Refresh Symbols" button.
 * No API keys required — CoinGecko public API + exchange public endpoints.
 */
import 'dotenv/config';

import { SymbolRefreshService } from '../apps/api/src/services/symbol-refresh.service';

async function main() {
  console.log('=== Seed Exchange Symbols ===\n');
  console.log('Fetching top 100 coins from CoinGecko...');
  console.log('Intersecting with available exchange products...\n');

  const service = new SymbolRefreshService();
  const summary = await service.refresh(100);

  console.log('\n=== Refresh Summary ===');
  console.log(`  Added:       ${summary.added}`);
  console.log(`  Updated:     ${summary.updated}`);
  console.log(`  Deactivated: ${summary.deactivated}`);
  console.log(`  Timestamp:   ${summary.timestamp}`);
  console.log('\nPer Exchange:');
  for (const [exchange, stats] of Object.entries(summary.perExchange)) {
    console.log(`  ${exchange}: +${stats.added} updated=${stats.updated} deactivated=${stats.deactivated}`);
  }

  console.log('\nDone! Exchange symbols are now populated.');
  process.exit(0);
}

main().catch((error) => {
  console.error('Failed to seed exchange symbols:', error);
  process.exit(1);
});
