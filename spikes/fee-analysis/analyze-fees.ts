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
import { CoinbaseRestClient, type CoinbaseOrder, type CoinbaseTransactionSummary } from '@livermore/coinbase-client';
import {
  calculateSymbolFees,
  calculateSideFees,
  calculateMonthlyFees,
  type SymbolFeeReport,
  type SideFeeReport,
  type MonthlyFeeReport,
} from './calculations.js';

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

/**
 * Display symbol fee report as formatted table
 */
function displaySymbolFees(reports: SymbolFeeReport[]): void {
  if (reports.length === 0) {
    console.log('No symbol data to display.');
    return;
  }

  // Header
  console.log(
    'Symbol'.padEnd(14) +
    'Total Fees'.padStart(14) +
    'Total Volume'.padStart(16) +
    'Eff Rate'.padStart(10) +
    'Avg Fee'.padStart(12) +
    'Orders'.padStart(8)
  );
  console.log('-'.repeat(74));

  // Data rows
  for (const report of reports) {
    console.log(
      report.symbol.padEnd(14) +
      formatCurrency(report.totalFees).padStart(14) +
      formatCurrency(report.totalVolume).padStart(16) +
      (report.effectiveFeeRate.toFixed(3) + '%').padStart(10) +
      formatCurrency(report.averageFeePerTrade).padStart(12) +
      report.orderCount.toString().padStart(8)
    );
  }

  // Summary row
  const totals = reports.reduce(
    (acc, r) => ({
      fees: acc.fees + r.totalFees,
      volume: acc.volume + r.totalVolume,
      orders: acc.orders + r.orderCount,
    }),
    { fees: 0, volume: 0, orders: 0 }
  );
  const overallRate = totals.volume > 0 ? (totals.fees / totals.volume) * 100 : 0;

  console.log('-'.repeat(74));
  console.log(
    'TOTAL'.padEnd(14) +
    formatCurrency(totals.fees).padStart(14) +
    formatCurrency(totals.volume).padStart(16) +
    (overallRate.toFixed(3) + '%').padStart(10) +
    ''.padStart(12) +
    totals.orders.toString().padStart(8)
  );
}

/**
 * Display side fee comparison as formatted table
 */
function displaySideFees(reports: SideFeeReport[]): void {
  if (reports.length === 0) {
    console.log('No side data to display.');
    return;
  }

  // Header
  console.log(
    'Symbol'.padEnd(14) +
    'Side'.padEnd(6) +
    'Total Fees'.padStart(14) +
    'Total Volume'.padStart(16) +
    'Eff Rate'.padStart(10) +
    'Orders'.padStart(8)
  );
  console.log('-'.repeat(68));

  // Group by symbol for easier comparison
  let currentSymbol = '';
  for (const report of reports) {
    if (report.symbol !== currentSymbol && currentSymbol !== '') {
      console.log(''); // Blank line between symbols
    }
    currentSymbol = report.symbol;

    console.log(
      report.symbol.padEnd(14) +
      report.side.padEnd(6) +
      formatCurrency(report.totalFees).padStart(14) +
      formatCurrency(report.totalVolume).padStart(16) +
      (report.effectiveFeeRate.toFixed(3) + '%').padStart(10) +
      report.orderCount.toString().padStart(8)
    );
  }
}

/**
 * Display monthly fee breakdown as formatted table
 */
function displayMonthlyFees(reports: MonthlyFeeReport[]): void {
  if (reports.length === 0) {
    console.log('No monthly data to display.');
    return;
  }

  // Header
  console.log(
    'Month'.padEnd(10) +
    'Total Fees'.padStart(14) +
    'Total Volume'.padStart(16) +
    'Eff Rate'.padStart(10) +
    'Orders'.padStart(8)
  );
  console.log('-'.repeat(58));

  // Data rows
  for (const report of reports) {
    console.log(
      report.yearMonth.padEnd(10) +
      formatCurrency(report.totalFees).padStart(14) +
      formatCurrency(report.totalVolume).padStart(16) +
      (report.effectiveFeeRate.toFixed(3) + '%').padStart(10) +
      report.orderCount.toString().padStart(8)
    );
  }

  // Summary row
  const totals = reports.reduce(
    (acc, r) => ({
      fees: acc.fees + r.totalFees,
      volume: acc.volume + r.totalVolume,
      orders: acc.orders + r.orderCount,
    }),
    { fees: 0, volume: 0, orders: 0 }
  );
  const overallRate = totals.volume > 0 ? (totals.fees / totals.volume) * 100 : 0;

  console.log('-'.repeat(58));
  console.log(
    'TOTAL'.padEnd(10) +
    formatCurrency(totals.fees).padStart(14) +
    formatCurrency(totals.volume).padStart(16) +
    (overallRate.toFixed(3) + '%').padStart(10) +
    totals.orders.toString().padStart(8)
  );
}

// ============================================================
// Markdown Generation Functions
// ============================================================

/**
 * Generate a markdown table from headers and rows
 */
function generateMarkdownTable(
  headers: string[],
  rows: string[][],
  alignments?: ('left' | 'right')[]
): string {
  const lines: string[] = [];

  // Header row
  lines.push('| ' + headers.join(' | ') + ' |');

  // Separator row with alignment
  const separators = headers.map((_, i) => {
    const align = alignments?.[i] || 'left';
    return align === 'right' ? '---:' : '---';
  });
  lines.push('| ' + separators.join(' | ') + ' |');

  // Data rows
  for (const row of rows) {
    lines.push('| ' + row.join(' | ') + ' |');
  }

  return lines.join('\n');
}

/**
 * Generate markdown table for symbol fee report
 */
function generateSymbolTable(reports: SymbolFeeReport[]): string {
  const headers = ['Symbol', 'Total Fees', 'Total Volume', 'Eff Rate', 'Avg Fee', 'Orders'];
  const alignments: ('left' | 'right')[] = ['left', 'right', 'right', 'right', 'right', 'right'];

  const rows: string[][] = reports.map(r => [
    r.symbol,
    formatCurrency(r.totalFees),
    formatCurrency(r.totalVolume),
    r.effectiveFeeRate.toFixed(3) + '%',
    formatCurrency(r.averageFeePerTrade),
    r.orderCount.toString(),
  ]);

  // Calculate totals row
  const totals = reports.reduce(
    (acc, r) => ({
      fees: acc.fees + r.totalFees,
      volume: acc.volume + r.totalVolume,
      orders: acc.orders + r.orderCount,
    }),
    { fees: 0, volume: 0, orders: 0 }
  );
  const overallRate = totals.volume > 0 ? (totals.fees / totals.volume) * 100 : 0;

  rows.push([
    '**TOTAL**',
    '**' + formatCurrency(totals.fees) + '**',
    '**' + formatCurrency(totals.volume) + '**',
    '**' + overallRate.toFixed(3) + '%**',
    '',
    '**' + totals.orders.toString() + '**',
  ]);

  return generateMarkdownTable(headers, rows, alignments);
}

/**
 * Generate markdown table for side fee report
 */
function generateSideTable(reports: SideFeeReport[]): string {
  const headers = ['Symbol', 'Side', 'Total Fees', 'Total Volume', 'Eff Rate', 'Orders'];
  const alignments: ('left' | 'right')[] = ['left', 'left', 'right', 'right', 'right', 'right'];

  const rows: string[][] = reports.map(r => [
    r.symbol,
    r.side,
    formatCurrency(r.totalFees),
    formatCurrency(r.totalVolume),
    r.effectiveFeeRate.toFixed(3) + '%',
    r.orderCount.toString(),
  ]);

  return generateMarkdownTable(headers, rows, alignments);
}

/**
 * Generate markdown table for monthly fee report
 */
function generateMonthlyTable(reports: MonthlyFeeReport[]): string {
  const headers = ['Month', 'Total Fees', 'Total Volume', 'Eff Rate', 'Orders'];
  const alignments: ('left' | 'right')[] = ['left', 'right', 'right', 'right', 'right'];

  const rows: string[][] = reports.map(r => [
    r.yearMonth,
    formatCurrency(r.totalFees),
    formatCurrency(r.totalVolume),
    r.effectiveFeeRate.toFixed(3) + '%',
    r.orderCount.toString(),
  ]);

  // Calculate totals row
  const totals = reports.reduce(
    (acc, r) => ({
      fees: acc.fees + r.totalFees,
      volume: acc.volume + r.totalVolume,
      orders: acc.orders + r.orderCount,
    }),
    { fees: 0, volume: 0, orders: 0 }
  );
  const overallRate = totals.volume > 0 ? (totals.fees / totals.volume) * 100 : 0;

  rows.push([
    '**TOTAL**',
    '**' + formatCurrency(totals.fees) + '**',
    '**' + formatCurrency(totals.volume) + '**',
    '**' + overallRate.toFixed(3) + '%**',
    '**' + totals.orders.toString() + '**',
  ]);

  return generateMarkdownTable(headers, rows, alignments);
}

/**
 * Generate complete markdown report
 */
function generateReport(data: {
  feeTier: CoinbaseTransactionSummary;
  symbolFees: SymbolFeeReport[];
  sideFees: SideFeeReport[];
  monthlyFees: MonthlyFeeReport[];
  dateRange: { earliest: string; latest: string } | null;
  orderCount: number;
}): string {
  const generatedDate = new Date().toISOString().split('T')[0];
  const dateRangeStr = data.dateRange
    ? `${formatDate(data.dateRange.earliest)} to ${formatDate(data.dateRange.latest)}`
    : 'N/A';

  return `# Coinbase Fee Analysis Report

**Generated:** ${generatedDate}
**Data Range:** ${dateRangeStr}
**Total Orders:** ${data.orderCount}

## Current Fee Tier

| Property | Value |
|----------|-------|
| Tier | ${data.feeTier.fee_tier.pricing_tier} |
| Maker Rate | ${formatPercent(data.feeTier.fee_tier.maker_fee_rate)} |
| Taker Rate | ${formatPercent(data.feeTier.fee_tier.taker_fee_rate)} |
| 30-Day Volume | ${formatCurrency(data.feeTier.advanced_trade_only_volume)} |
| 30-Day Fees | ${formatCurrency(data.feeTier.advanced_trade_only_fees)} |

## Fee Analysis by Symbol

${generateSymbolTable(data.symbolFees)}

## Buy vs Sell Comparison

${generateSideTable(data.sideFees)}

## Monthly Breakdown

${generateMonthlyTable(data.monthlyFees)}
`;
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

    // Calculate and display fee analysis
    console.log('\n=== Fee Analysis by Symbol ===\n');
    const symbolFees = calculateSymbolFees(orders);
    displaySymbolFees(symbolFees);

    console.log('\n=== Buy vs Sell Comparison ===\n');
    const sideFees = calculateSideFees(orders);
    displaySideFees(sideFees);

    console.log('\n=== Monthly Breakdown ===\n');
    const monthlyFees = calculateMonthlyFees(orders);
    displayMonthlyFees(monthlyFees);

    console.log('\nFee analysis complete.');

  } catch (error) {
    console.error('\nError fetching data:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
