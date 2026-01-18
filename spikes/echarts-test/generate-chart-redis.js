/**
 * ECharts MACD-V Chart - Redis Data Version
 *
 * Fetches real candle data from Redis and generates chart.
 * Note: MACD-V is calculated on-the-fly from candles (simplified for spike)
 */

const echarts = require('echarts');
const { createCanvas } = require('canvas');
const Redis = require('ioredis');
const fs = require('fs');

// Hermes Color Zones
const HERMES_COLORS = {
  grayblue: '#7A8CA3',
  aqua: '#33C3F0',
  lime: '#2ECC71',
  yellow: '#F1C40F',
  orange: '#F39C12',
  red: '#E74C3C',
};

// Dark theme colors
const DARK_THEME = {
  background: '#1a1a2e',
  text: '#e0e0e0',
  textSecondary: '#888888',
  grid: '#2d2d44',
  axisLine: '#444466',
};

// Get color based on MACD-V magnitude
function getMacdVColor(value) {
  const abs = Math.abs(value);
  if (abs < 50) return HERMES_COLORS.grayblue;
  if (abs < 75) return HERMES_COLORS.aqua;
  if (abs < 125) return HERMES_COLORS.lime;
  if (abs < 140) return HERMES_COLORS.yellow;
  if (abs < 150) return HERMES_COLORS.orange;
  return HERMES_COLORS.red;
}

// Simple EMA calculation
function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  const emaArray = [data[0]];

  for (let i = 1; i < data.length; i++) {
    emaArray.push(data[i] * k + emaArray[i - 1] * (1 - k));
  }

  return emaArray;
}

// Simple ATR calculation (Wilder smoothing)
function calculateATR(candles, period) {
  const trueRanges = [];

  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trueRanges.push(candles[i].high - candles[i].low);
    } else {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trueRanges.push(tr);
    }
  }

  // Wilder smoothing (RMA)
  const atr = [trueRanges.slice(0, period).reduce((a, b) => a + b) / period];

  for (let i = period; i < trueRanges.length; i++) {
    atr.push((atr[atr.length - 1] * (period - 1) + trueRanges[i]) / period);
  }

  // Pad beginning with nulls
  return Array(period - 1).fill(null).concat(atr);
}

// Calculate MACD-V from candles
function calculateMACDV(candles) {
  const closes = candles.map(c => c.close);

  // EMA calculations
  const fastEMA = calculateEMA(closes, 12);
  const slowEMA = calculateEMA(closes, 26);
  const atr = calculateATR(candles, 26);

  // MACD-V = (fastEMA - slowEMA) / ATR * 100
  const macdV = [];
  for (let i = 0; i < candles.length; i++) {
    if (atr[i] === null || atr[i] === 0) {
      macdV.push(null);
    } else {
      macdV.push(((fastEMA[i] - slowEMA[i]) / atr[i]) * 100);
    }
  }

  // Signal line = EMA(MACD-V, 9)
  const validMacdV = macdV.filter(v => v !== null);
  const signalEMA = calculateEMA(validMacdV, 9);

  // Map signal back to full array
  const signal = [];
  let signalIdx = 0;
  for (let i = 0; i < macdV.length; i++) {
    if (macdV[i] === null) {
      signal.push(null);
    } else {
      signal.push(signalEMA[signalIdx++]);
    }
  }

  // Histogram
  const histogram = macdV.map((v, i) => {
    if (v === null || signal[i] === null) return null;
    return v - signal[i];
  });

  // EMA(9) of price
  const ema9 = calculateEMA(closes, 9);

  return { macdV, signal, histogram, ema9 };
}

// Fetch candles from Redis
async function fetchCandles(redis, symbol, timeframe, count) {
  const userId = 1;
  const exchangeId = 1;
  const key = `candles:${userId}:${exchangeId}:${symbol}:${timeframe}`;

  console.log(`Fetching from Redis key: ${key}`);

  // Get the most recent N candles
  const results = await redis.zrange(key, -count, -1);

  if (results.length === 0) {
    throw new Error(`No candles found for ${symbol}:${timeframe}`);
  }

  console.log(`Found ${results.length} candles`);

  return results.map(json => JSON.parse(json));
}

// Create the chart
function createMacdVChart(candles, indicators, symbol, timeframe) {
  const canvas = createCanvas(800, 500);
  const chart = echarts.init(canvas);

  // Format time labels
  const times = candles.map(c => {
    const d = new Date(c.timestamp);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  });

  const prices = candles.map(c => c.close);
  const { macdV, signal, histogram, ema9 } = indicators;

  // Histogram bars colored by magnitude
  const histogramData = histogram.map((h) => ({
    value: h,
    itemStyle: {
      color: h !== null ? getMacdVColor(h) : HERMES_COLORS.grayblue,
    }
  }));

  const option = {
    backgroundColor: DARK_THEME.background,

    title: [
      {
        text: `${symbol} - Price - EMA(9)`,
        left: 'center',
        top: 5,
        textStyle: { color: DARK_THEME.text, fontSize: 14, fontWeight: 'normal' }
      },
      {
        text: `MACD-V (12,26,9) - ${timeframe}`,
        left: 'center',
        top: '52%',
        textStyle: { color: DARK_THEME.text, fontSize: 12, fontWeight: 'normal' }
      }
    ],

    legend: [
      {
        data: ['Price', 'EMA(9)'],
        top: 25,
        left: 'center',
        textStyle: { color: DARK_THEME.textSecondary, fontSize: 10 },
        itemWidth: 15,
        itemHeight: 2,
      },
      {
        data: ['MACD-V', 'Signal', 'Histogram'],
        top: '56%',
        left: 'center',
        textStyle: { color: DARK_THEME.textSecondary, fontSize: 10 },
        itemWidth: 15,
        itemHeight: 2,
      }
    ],

    grid: [
      { left: 60, right: 20, top: 50, height: '35%' },
      { left: 60, right: 20, top: '60%', height: '32%' }
    ],

    xAxis: [
      {
        type: 'category',
        data: times,
        gridIndex: 0,
        axisLine: { lineStyle: { color: DARK_THEME.axisLine } },
        axisLabel: { show: false },
        axisTick: { show: false },
      },
      {
        type: 'category',
        data: times,
        gridIndex: 1,
        axisLine: { lineStyle: { color: DARK_THEME.axisLine } },
        axisLabel: { color: DARK_THEME.textSecondary, fontSize: 9, interval: 4 },
        axisTick: { show: false },
      }
    ],

    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        scale: true,
        splitLine: { lineStyle: { color: DARK_THEME.grid, type: 'dashed' } },
        axisLine: { lineStyle: { color: DARK_THEME.axisLine } },
        axisLabel: { color: DARK_THEME.textSecondary, fontSize: 9, formatter: v => v.toFixed(0) },
      },
      {
        type: 'value',
        gridIndex: 1,
        splitLine: { lineStyle: { color: DARK_THEME.grid, type: 'dashed' } },
        axisLine: { lineStyle: { color: DARK_THEME.axisLine } },
        axisLabel: { color: DARK_THEME.textSecondary, fontSize: 9 },
      }
    ],

    series: [
      // Price line
      {
        name: 'Price',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: prices,
        symbol: 'none',
        lineStyle: { color: '#5cadff', width: 1.5 },
      },
      // EMA(9) line
      {
        name: 'EMA(9)',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ema9,
        symbol: 'none',
        lineStyle: { color: '#ffaa00', width: 1.5 },
      },
      // Histogram bars
      {
        name: 'Histogram',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: histogramData,
        barWidth: '40%',
        z: 1,
        itemStyle: { opacity: 0.7 },
      },
      // Signal line
      {
        name: 'Signal',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: signal,
        symbol: 'none',
        lineStyle: { color: '#ffaa00', width: 1.5 },
      },
      // MACD-V scatter points
      {
        name: 'MACD-V',
        type: 'scatter',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: macdV.map((v, i) => ({
          value: [i, v],
          itemStyle: { color: v !== null ? getMacdVColor(v) : HERMES_COLORS.grayblue },
        })),
        symbolSize: 8,
      },
      // MACD-V connecting line
      {
        name: 'MACD-V Line',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: macdV,
        symbol: 'none',
        lineStyle: { color: DARK_THEME.textSecondary, width: 1, opacity: 0.5 },
        silent: true,
      },
      // Reference lines
      {
        type: 'line', xAxisIndex: 1, yAxisIndex: 1,
        data: Array(times.length).fill(150),
        symbol: 'none',
        lineStyle: { color: HERMES_COLORS.red, width: 1, type: 'dashed' },
        silent: true,
      },
      {
        type: 'line', xAxisIndex: 1, yAxisIndex: 1,
        data: Array(times.length).fill(50),
        symbol: 'none',
        lineStyle: { color: HERMES_COLORS.aqua, width: 1, type: 'dashed', opacity: 0.5 },
        silent: true,
      },
      {
        type: 'line', xAxisIndex: 1, yAxisIndex: 1,
        data: Array(times.length).fill(-50),
        symbol: 'none',
        lineStyle: { color: HERMES_COLORS.aqua, width: 1, type: 'dashed', opacity: 0.5 },
        silent: true,
      },
      {
        type: 'line', xAxisIndex: 1, yAxisIndex: 1,
        data: Array(times.length).fill(-150),
        symbol: 'none',
        lineStyle: { color: HERMES_COLORS.red, width: 1, type: 'dashed' },
        silent: true,
      },
    ],
  };

  chart.setOption(option);
  return chart;
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const symbol = args[0] || 'BTC-USD';
  const timeframe = args[1] || '1m';
  const bars = parseInt(args[2]) || 25;

  console.log(`Generating chart for ${symbol} (${timeframe}, ${bars} bars)`);

  // Connect to Redis
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  });

  try {
    // Fetch candles
    const candles = await fetchCandles(redis, symbol, timeframe, bars + 30); // Extra for EMA warmup

    // Calculate indicators
    console.log('Calculating MACD-V...');
    const indicators = calculateMACDV(candles);

    // Use only the last N bars for display
    const displayCandles = candles.slice(-bars);
    const displayIndicators = {
      macdV: indicators.macdV.slice(-bars),
      signal: indicators.signal.slice(-bars),
      histogram: indicators.histogram.slice(-bars),
      ema9: indicators.ema9.slice(-bars),
    };

    // Create chart
    console.log('Creating chart...');
    const chart = createMacdVChart(displayCandles, displayIndicators, symbol, timeframe);

    // Export
    console.log('Exporting to PNG...');
    const buffer = chart.getDom().toBuffer('image/png');

    const outputPath = `${__dirname}/macdv-chart-${symbol.replace('/', '-')}-${timeframe}.png`;
    fs.writeFileSync(outputPath, buffer);

    console.log(`Chart saved to: ${outputPath}`);

    chart.dispose();
  } finally {
    redis.disconnect();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
