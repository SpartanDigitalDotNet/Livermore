/**
 * Recalculate MACD-V indicators for all symbols across all timeframes
 * Run with: npx tsx scripts/recalculate-indicators.ts
 */
import Redis from 'ioredis';
import {
  CandleCacheStrategy,
  IndicatorCacheStrategy,
  type CachedIndicatorValue,
} from '@livermore/cache';
import {
  macdVWithStage,
  MACD_V_DEFAULTS,
  type OHLCWithSynthetic,
} from '@livermore/indicators';
import { fillCandleGaps, calculateZeroRangeRatio } from '@livermore/utils';
import { classifyLiquidity, type Timeframe, type LiquidityTier } from '@livermore/schemas';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6400');
const candleCache = new CandleCacheStrategy(redis);
const indicatorCache = new IndicatorCacheStrategy(redis);

const USER_ID = 1;
const EXCHANGE_ID = 1;
const REQUIRED_CANDLES = 60;

const SYMBOLS = [
  'BTC-USD', 'ETH-USD', 'XRP-USD', 'LINK-USD', 'BONK-USD',
  'ONDO-USD', 'PENGU-USD', 'WLD-USD', 'TOSHI-USD', 'SYRUP-USD',
  'GFI-USD', 'DIA-USD', 'NEON-USD', 'DIMO-USD', 'SKL-USD',
  'MATH-USD', 'CTX-USD', 'SPK-USD', 'OMNI-USD', 'METIS-USD',
  'LRDS-USD', 'ASM-USD', 'NOICE-USD', 'LCX-USD', 'SD-USD'
];

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

async function calculateIndicator(symbol: string, timeframe: Timeframe): Promise<boolean> {
  // Get candles from cache
  const candles = await candleCache.getRecentCandles(USER_ID, EXCHANGE_ID, symbol, timeframe, 200);

  if (candles.length < REQUIRED_CANDLES) {
    console.log(`  ${symbol} ${timeframe}: Skip - only ${candles.length} candles (need ${REQUIRED_CANDLES})`);
    return false;
  }

  // Fill gaps
  const { candles: filledCandles, stats } = fillCandleGaps(candles, timeframe);
  const liquidity: LiquidityTier = classifyLiquidity(stats.gapRatio);
  const zeroRangeRatio = calculateZeroRangeRatio(filledCandles);

  // Convert to OHLC format
  const ohlcBars: OHLCWithSynthetic[] = filledCandles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    isSynthetic: c.isSynthetic,
  }));

  // Calculate MACD-V
  const result = macdVWithStage(ohlcBars);

  if (!result) {
    console.log(`  ${symbol} ${timeframe}: MACD-V calculation returned null`);
    return false;
  }

  const latestCandle = filledCandles[filledCandles.length - 1];

  // Create indicator value
  const indicatorValue: CachedIndicatorValue = {
    timestamp: latestCandle.timestamp,
    type: 'macd-v',
    symbol,
    timeframe,
    value: {
      macdV: result.macdV,
      signal: result.signal,
      histogram: result.histogram,
      fastEMA: result.fastEMA,
      slowEMA: result.slowEMA,
      atr: result.atr,
    },
    params: {
      fastPeriod: MACD_V_DEFAULTS.fastPeriod,
      slowPeriod: MACD_V_DEFAULTS.slowPeriod,
      atrPeriod: MACD_V_DEFAULTS.atrPeriod,
      signalPeriod: MACD_V_DEFAULTS.signalPeriod,
      stage: result.stage,
      liquidity,
      gapRatio: stats.gapRatio,
      zeroRangeRatio,
      seeded: result.seeded,
      nEff: result.nEff,
      spanBars: result.spanBars,
      reason: result.reason,
    },
  };

  // Cache the indicator
  await indicatorCache.setIndicator(USER_ID, EXCHANGE_ID, indicatorValue);

  console.log(`  ${symbol} ${timeframe}: MACD-V=${result.macdV.toFixed(2)} stage=${result.stage} (${candles.length} candles)`);
  return true;
}

async function main() {
  console.log('Recalculating MACD-V indicators...');
  console.log(`Symbols: ${SYMBOLS.length}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log('');

  let calculated = 0;
  let skipped = 0;

  for (const timeframe of TIMEFRAMES) {
    console.log(`\n=== ${timeframe} ===`);

    for (const symbol of SYMBOLS) {
      const success = await calculateIndicator(symbol, timeframe);
      if (success) {
        calculated++;
      } else {
        skipped++;
      }
    }
  }

  console.log(`\n\nRecalculation complete!`);
  console.log(`Calculated: ${calculated}`);
  console.log(`Skipped: ${skipped}`);

  // Verify indicator keys
  const indicatorKeys = await redis.keys('indicator:*');
  console.log(`\nIndicator keys in Redis: ${indicatorKeys.length}`);

  await redis.quit();
}

main().catch(err => {
  console.error('Recalculation failed:', err);
  redis.quit();
  process.exit(1);
});
