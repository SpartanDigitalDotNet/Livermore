/**
 * Coinbase Fee Analysis Spike
 *
 * Demonstrates data retrieval for fee analysis:
 * - Fetches current fee tier and 30-day volume
 * - Retrieves all filled orders with pagination
 * - Displays summary statistics
 *
 * Run with: pnpm analyze
 * Requires:
 *   - Coinbase_ApiKeyId and Coinbase_EcPrivateKeyPem env vars
 */
import { CoinbaseRestClient, type CoinbaseOrder } from '@livermore/coinbase-client';

// Read credentials from environment
const apiKeyId = process.env.Coinbase_ApiKeyId;
const privateKey = process.env.Coinbase_EcPrivateKeyPem?.replace(/\\n/g, '\n');

if (!apiKeyId || !privateKey) {
  console.error('Missing Coinbase credentials in environment');
  console.error('Set Coinbase_ApiKeyId and Coinbase_EcPrivateKeyPem');
  process.exit(1);
}

/**
 * Format currency value with commas and dollar sign
 */
function formatCurrency(value: number): string {
  return '$' + value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format percentage
 */
function formatPercent(rate: string | number): string {
  const num = typeof rate === 'string' ? parseFloat(rate) : rate;
  return (num * 100).toFixed(2) + '%';
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(isoDate: string): string {
  return isoDate.split('T')[0];
}

/**
 * Get unique symbols from orders
 */
function getUniqueSymbols(orders: CoinbaseOrder[]): string[] {
  const symbols = new Set<string>();
  for (const order of orders) {
    symbols.add(order.product_id);
  }
  return Array.from(symbols).sort();
}

/**
 * Get date range from orders
 */
function getDateRange(orders: CoinbaseOrder[]): { earliest: string; latest: string } | null {
  if (orders.length === 0) return null;

  let earliest = orders[0].created_time;
  let latest = orders[0].created_time;

  for (const order of orders) {
    if (order.created_time < earliest) earliest = order.created_time;
    if (order.created_time > latest) latest = order.created_time;
  }

  return { earliest, latest };
}

async function main() {
  console.log('=== Coinbase Fee Analysis ===\n');

  const client = new CoinbaseRestClient(apiKeyId!, privateKey!);

  try {
    // Fetch transaction summary (fee tier info)
    console.log('Fetching fee tier information...');
    const summary = await client.getTransactionSummary();

    console.log('\nFee Tier Information:');
    console.log(`  Tier: ${summary.fee_tier.pricing_tier}`);
    console.log(`  Maker Rate: ${formatPercent(summary.fee_tier.maker_fee_rate)}`);
    console.log(`  Taker Rate: ${formatPercent(summary.fee_tier.taker_fee_rate)}`);
    console.log(`  30-Day Volume: ${formatCurrency(summary.advanced_trade_only_volume)}`);
    console.log(`  30-Day Fees: ${formatCurrency(summary.advanced_trade_only_fees)}`);

    // Fetch all filled orders
    console.log('\nFetching filled orders (this may take a moment for large histories)...');
    const orders = await client.getFilledOrders();

    console.log('\nOrder History:');
    console.log(`  Total Orders: ${orders.length}`);

    const dateRange = getDateRange(orders);
    if (dateRange) {
      console.log(`  Date Range: ${formatDate(dateRange.earliest)} to ${formatDate(dateRange.latest)}`);
    } else {
      console.log('  Date Range: N/A (no orders)');
    }

    const symbols = getUniqueSymbols(orders);
    if (symbols.length > 0) {
      const symbolDisplay = symbols.length <= 5
        ? symbols.join(', ')
        : `${symbols.slice(0, 5).join(', ')}... (${symbols.length} total)`;
      console.log(`  Symbols: ${symbolDisplay}`);
    } else {
      console.log('  Symbols: N/A (no orders)');
    }

    // Calculate total fees from orders
    let totalFees = 0;
    for (const order of orders) {
      totalFees += parseFloat(order.total_fees || '0');
    }
    console.log(`  Total Fees (from orders): ${formatCurrency(totalFees)}`);

    console.log('\nData retrieval complete.');

  } catch (error) {
    console.error('\nError fetching data:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
