/**
 * Fee Calculation Functions
 *
 * Pure functions for aggregating and analyzing Coinbase order fee data.
 * Used by analyze-fees.ts to generate fee reports.
 */
import type { CoinbaseOrder } from '@livermore/exchange-core';

/**
 * Fee report aggregated by trading pair (symbol)
 */
export interface SymbolFeeReport {
  symbol: string;
  totalFees: number;
  totalVolume: number;
  effectiveFeeRate: number; // as percentage (e.g., 0.5 for 0.5%)
  averageFeePerTrade: number;
  orderCount: number;
}

/**
 * Fee report aggregated by symbol and trade side
 */
export interface SideFeeReport {
  symbol: string;
  side: 'BUY' | 'SELL';
  totalFees: number;
  totalVolume: number;
  effectiveFeeRate: number;
  orderCount: number;
}

/**
 * Fee report aggregated by calendar month
 */
export interface MonthlyFeeReport {
  yearMonth: string; // "YYYY-MM" format
  totalFees: number;
  totalVolume: number;
  effectiveFeeRate: number;
  orderCount: number;
}

/**
 * Calculate fee totals and rates per trading pair (symbol)
 *
 * Groups orders by product_id and calculates:
 * - Total fees paid
 * - Total volume traded
 * - Effective fee rate (fees/volume as percentage)
 * - Average fee per trade
 *
 * @returns Array sorted by totalFees descending (highest fees first)
 */
export function calculateSymbolFees(orders: CoinbaseOrder[]): SymbolFeeReport[] {
  const symbolMap = new Map<string, CoinbaseOrder[]>();

  // Group orders by symbol
  for (const order of orders) {
    const symbol = order.product_id;
    const existing = symbolMap.get(symbol) || [];
    existing.push(order);
    symbolMap.set(symbol, existing);
  }

  // Calculate metrics for each symbol
  const reports: SymbolFeeReport[] = [];
  for (const [symbol, symbolOrders] of symbolMap) {
    let totalFees = 0;
    let totalVolume = 0;

    for (const order of symbolOrders) {
      totalFees += parseFloat(order.total_fees || '0');
      totalVolume += parseFloat(order.filled_value || '0');
    }

    const effectiveFeeRate = totalVolume > 0 ? (totalFees / totalVolume) * 100 : 0;
    const averageFeePerTrade = symbolOrders.length > 0 ? totalFees / symbolOrders.length : 0;

    reports.push({
      symbol,
      totalFees,
      totalVolume,
      effectiveFeeRate,
      averageFeePerTrade,
      orderCount: symbolOrders.length,
    });
  }

  // Sort by totalFees descending
  return reports.sort((a, b) => b.totalFees - a.totalFees);
}

/**
 * Calculate fee totals and rates per symbol and trade side (BUY vs SELL)
 *
 * Groups orders by symbol+side and calculates metrics for each combination.
 * Useful for comparing maker vs taker fees or analyzing buy/sell fee differences.
 *
 * @returns Array sorted by symbol, then side (BUY before SELL)
 */
export function calculateSideFees(orders: CoinbaseOrder[]): SideFeeReport[] {
  const sideMap = new Map<string, CoinbaseOrder[]>();

  // Group orders by symbol:side
  for (const order of orders) {
    const key = `${order.product_id}:${order.side}`;
    const existing = sideMap.get(key) || [];
    existing.push(order);
    sideMap.set(key, existing);
  }

  // Calculate metrics for each symbol+side combination
  const reports: SideFeeReport[] = [];
  for (const [key, sideOrders] of sideMap) {
    const [symbol, side] = key.split(':');
    let totalFees = 0;
    let totalVolume = 0;

    for (const order of sideOrders) {
      totalFees += parseFloat(order.total_fees || '0');
      totalVolume += parseFloat(order.filled_value || '0');
    }

    const effectiveFeeRate = totalVolume > 0 ? (totalFees / totalVolume) * 100 : 0;

    reports.push({
      symbol,
      side: side as 'BUY' | 'SELL',
      totalFees,
      totalVolume,
      effectiveFeeRate,
      orderCount: sideOrders.length,
    });
  }

  // Sort by symbol, then side (BUY before SELL)
  return reports.sort((a, b) => {
    const symbolCompare = a.symbol.localeCompare(b.symbol);
    if (symbolCompare !== 0) return symbolCompare;
    return a.side === 'BUY' ? -1 : 1;
  });
}

/**
 * Calculate fee totals and rates per calendar month
 *
 * Groups orders by year-month and calculates monthly aggregates.
 * Useful for tracking how volume tiers affect effective fee rates over time.
 *
 * @returns Array sorted by yearMonth ascending (chronological order)
 */
export function calculateMonthlyFees(orders: CoinbaseOrder[]): MonthlyFeeReport[] {
  const monthMap = new Map<string, CoinbaseOrder[]>();

  // Group orders by year-month
  for (const order of orders) {
    // Extract YYYY-MM from ISO timestamp (e.g., "2024-01-15T10:30:00Z" -> "2024-01")
    const yearMonth = order.created_time.substring(0, 7);
    const existing = monthMap.get(yearMonth) || [];
    existing.push(order);
    monthMap.set(yearMonth, existing);
  }

  // Calculate metrics for each month
  const reports: MonthlyFeeReport[] = [];
  for (const [yearMonth, monthOrders] of monthMap) {
    let totalFees = 0;
    let totalVolume = 0;

    for (const order of monthOrders) {
      totalFees += parseFloat(order.total_fees || '0');
      totalVolume += parseFloat(order.filled_value || '0');
    }

    const effectiveFeeRate = totalVolume > 0 ? (totalFees / totalVolume) * 100 : 0;

    reports.push({
      yearMonth,
      totalFees,
      totalVolume,
      effectiveFeeRate,
      orderCount: monthOrders.length,
    });
  }

  // Sort by yearMonth ascending (chronological)
  return reports.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
}
