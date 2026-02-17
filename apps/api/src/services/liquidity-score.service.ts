import { logger } from '@livermore/utils';
import type { ExchangeProduct } from './exchange-product.service';

/**
 * Input signals for liquidity scoring.
 * All fields optional — missing signals get their weight redistributed.
 */
export interface LiquidityInput {
  tradeCount24h?: number;
  quoteVolume24h: number;
  bidPrice?: number;
  askPrice?: number;
  bidQty?: number;
  askQty?: number;
}

/**
 * Weighted composite liquidity score (0-1 scale).
 *
 * Signals:
 * - Trade count (30%) — log-scaled, normalized to max in set
 * - Quote volume (30%) — log-scaled, normalized to max in set
 * - Spread (25%) — tighter = higher score, self-normalizing
 * - Book depth (15%) — bid+ask USD depth, log-scaled to 100K cap
 *
 * When a signal is unavailable, its weight is redistributed proportionally.
 */

const WEIGHTS = {
  tradeCount: 0.30,
  volume: 0.30,
  spread: 0.25,
  bookDepth: 0.15,
};

/**
 * Compute composite liquidity scores for a set of exchange products.
 * Scores are relative within the set (max trade count / max volume used for normalization).
 */
export function computeLiquidityScores(products: LiquidityInput[]): number[] {
  if (products.length === 0) return [];

  // Find max values for normalization
  let maxTradeCount = 0;
  let maxVolume = 0;
  for (const p of products) {
    if (p.tradeCount24h != null && p.tradeCount24h > maxTradeCount) {
      maxTradeCount = p.tradeCount24h;
    }
    if (p.quoteVolume24h > maxVolume) {
      maxVolume = p.quoteVolume24h;
    }
  }

  return products.map((p) => {
    const signals: { weight: number; value: number }[] = [];

    // Trade count signal
    if (p.tradeCount24h != null && maxTradeCount > 0) {
      const normalized = Math.log1p(p.tradeCount24h) / Math.log1p(maxTradeCount);
      signals.push({ weight: WEIGHTS.tradeCount, value: normalized });
    }

    // Volume signal
    if (maxVolume > 0) {
      const normalized = Math.log1p(p.quoteVolume24h) / Math.log1p(maxVolume);
      signals.push({ weight: WEIGHTS.volume, value: normalized });
    }

    // Spread signal (self-normalizing: 0-5% maps to 1-0)
    if (p.bidPrice != null && p.askPrice != null && p.bidPrice > 0) {
      const midPrice = (p.bidPrice + p.askPrice) / 2;
      const spreadPct = midPrice > 0 ? ((p.askPrice - p.bidPrice) / midPrice) * 100 : 5;
      const normalized = Math.max(0, 1 - spreadPct / 5);
      signals.push({ weight: WEIGHTS.spread, value: normalized });
    }

    // Book depth signal (log-scaled to 100K USD)
    if (p.bidQty != null && p.askQty != null) {
      // Convert to USD-equivalent depth using bid/ask prices
      const bidDepthUsd = p.bidPrice ? p.bidQty * p.bidPrice : p.bidQty;
      const askDepthUsd = p.askPrice ? p.askQty * p.askPrice : p.askQty;
      const totalDepth = bidDepthUsd + askDepthUsd;
      const normalized = Math.min(1, Math.log1p(totalDepth) / Math.log1p(100000));
      signals.push({ weight: WEIGHTS.bookDepth, value: normalized });
    }

    if (signals.length === 0) return 0;

    // Redistribute weights proportionally to available signals
    const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
    const score = signals.reduce((sum, s) => sum + (s.weight / totalWeight) * s.value, 0);

    // Clamp to [0, 1] and round to 3 decimal places
    return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
  });
}

/**
 * Map a liquidity score to a letter grade.
 */
export function liquidityGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 0.6) return 'A';
  if (score >= 0.4) return 'B';
  if (score >= 0.2) return 'C';
  if (score >= 0.05) return 'D';
  return 'F';
}

/**
 * Convert ExchangeProduct[] to LiquidityInput[] for scoring.
 */
export function productsToLiquidityInputs(products: ExchangeProduct[]): LiquidityInput[] {
  return products.map((p) => ({
    tradeCount24h: p.tradeCount24h,
    quoteVolume24h: p.volume24h,
    bidPrice: p.bidPrice,
    askPrice: p.askPrice,
    bidQty: p.bidQty,
    askQty: p.askQty,
  }));
}

/**
 * Score products and log a summary by grade.
 */
export function scoreAndSummarize(
  exchangeName: string,
  products: ExchangeProduct[]
): { scores: number[]; gradeA: number; gradeB: number; gradeC: number; gradeDOrF: number } {
  const inputs = productsToLiquidityInputs(products);
  const scores = computeLiquidityScores(inputs);

  let gradeA = 0, gradeB = 0, gradeC = 0, gradeDOrF = 0;
  for (const score of scores) {
    const grade = liquidityGrade(score);
    if (grade === 'A') gradeA++;
    else if (grade === 'B') gradeB++;
    else if (grade === 'C') gradeC++;
    else gradeDOrF++;
  }

  logger.info(
    { exchange: exchangeName, scored: scores.length, gradeA, gradeB, gradeC, gradeDOrF },
    'Liquidity scores computed'
  );

  return { scores, gradeA, gradeB, gradeC, gradeDOrF };
}
