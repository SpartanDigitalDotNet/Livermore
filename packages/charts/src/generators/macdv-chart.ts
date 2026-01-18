/**
 * MACD-V Chart Generator
 *
 * Generates server-side PNG charts using ECharts and node-canvas.
 * Two-panel layout:
 * - Top: Price candlesticks + EMA(9)
 * - Bottom: MACD-V dots (colored by Hermes zones) + Signal + Histogram
 */

import { createCanvas } from 'canvas';
import * as echarts from 'echarts';
import { macdV, type OHLCWithSynthetic } from '@livermore/indicators';
import type { Candle } from '@livermore/schemas';
import { HERMES_COLORS, getMacdVColor, MACD_V_LEVELS } from '../themes/hermes.js';
import { DARK_THEME, CANDLE_COLORS, LINE_COLORS } from '../themes/dark.js';
import type { ChartGenerationOptions, ChartResult } from '../types.js';

/**
 * Calculate EMA for a data series
 */
function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emaArray: number[] = [data[0]];

  for (let i = 1; i < data.length; i++) {
    emaArray.push(data[i] * k + emaArray[i - 1] * (1 - k));
  }

  return emaArray;
}

/**
 * Format price for Y-axis based on magnitude
 */
function formatPrice(value: number): string {
  if (value >= 1000) return value.toFixed(0);
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(4);
  return value.toFixed(6);
}

/**
 * Format time for X-axis labels
 */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Generate a MACD-V chart as PNG buffer
 *
 * @param options - Chart generation options
 * @returns Chart result with PNG buffer
 * @throws Error if insufficient candle data
 */
export function generateMacdVChart(options: ChartGenerationOptions): ChartResult {
  const {
    symbol,
    timeframe,
    candles,
    alertMarkers = [],
    width = 800,
    height = 500,
  } = options;

  // Minimum candles needed for valid MACD-V
  const minCandles = 35; // 26 for ATR + 9 for signal warmup
  if (candles.length < minCandles) {
    throw new Error(`Insufficient candles: need at least ${minCandles}, got ${candles.length}`);
  }

  // Convert candles to OHLC format for indicators package
  const ohlcBars: OHLCWithSynthetic[] = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    isSynthetic: (c as Candle & { isSynthetic?: boolean }).isSynthetic ?? false,
  }));

  // Calculate MACD-V using the indicators package
  const indicators = macdV(ohlcBars);

  if (!indicators.seeded) {
    throw new Error('MACD-V not seeded: insufficient trading activity');
  }

  // Calculate EMA(9) for price chart
  const closes = candles.map((c) => c.close);
  const ema9 = calculateEMA(closes, 9);

  // Create canvas and initialize ECharts
  const canvas = createCanvas(width, height);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chart = echarts.init(canvas as any);

  // Format time labels
  const times = candles.map((c) => formatTime(c.timestamp));
  const prices = candles.map((c) => c.close);

  // Candlestick data format: [open, close, low, high]
  const candlestickData = candles.map((c) => [c.open, c.close, c.low, c.high]);

  // Histogram bars colored by magnitude
  const histogramData = indicators.histogram.map((h) => ({
    value: h,
    itemStyle: {
      color: !Number.isNaN(h) ? getMacdVColor(h) : HERMES_COLORS.grayblue,
    },
  }));

  // Build ECharts option
  const option: echarts.EChartsOption = {
    backgroundColor: DARK_THEME.background,

    title: [
      {
        text: `${symbol} - Price - EMA(9)`,
        left: 'center',
        top: 5,
        textStyle: { color: DARK_THEME.text, fontSize: 14, fontWeight: 'normal' },
      },
      {
        text: `MACD-V (12,26,9) - ${timeframe}`,
        left: 'center',
        top: '52%',
        textStyle: { color: DARK_THEME.text, fontSize: 12, fontWeight: 'normal' },
      },
    ],

    legend: [
      {
        data: ['Candles', 'Price', 'EMA(9)'],
        top: 25,
        left: 'center',
        textStyle: { color: DARK_THEME.textSecondary, fontSize: 10 },
        itemWidth: 15,
        itemHeight: 10,
      },
      {
        data: ['MACD-V', 'Signal', 'Histogram'],
        top: '56%',
        left: 'center',
        textStyle: { color: DARK_THEME.textSecondary, fontSize: 10 },
        itemWidth: 15,
        itemHeight: 2,
      },
    ],

    grid: [
      { left: 60, right: 20, top: 50, height: '35%' },
      { left: 60, right: 20, top: '60%', height: '32%' },
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
      },
    ],

    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        scale: true,
        splitLine: { lineStyle: { color: DARK_THEME.grid, type: 'dashed' } },
        axisLine: { lineStyle: { color: DARK_THEME.axisLine } },
        axisLabel: {
          color: DARK_THEME.textSecondary,
          fontSize: 9,
          formatter: formatPrice,
        },
      },
      {
        type: 'value',
        gridIndex: 1,
        splitLine: { lineStyle: { color: DARK_THEME.grid, type: 'dashed' } },
        axisLine: { lineStyle: { color: DARK_THEME.axisLine } },
        axisLabel: { color: DARK_THEME.textSecondary, fontSize: 9 },
      },
    ],

    series: [
      // Candlesticks
      {
        name: 'Candles',
        type: 'candlestick',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: candlestickData,
        itemStyle: {
          color: CANDLE_COLORS.bullish,
          color0: CANDLE_COLORS.bearish,
          borderColor: CANDLE_COLORS.bullish,
          borderColor0: CANDLE_COLORS.bearish,
        },
        z: 1,
      },
      // Price line
      {
        name: 'Price',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: prices,
        symbol: 'none',
        lineStyle: { color: LINE_COLORS.price, width: 1.5 },
        z: 2,
      },
      // EMA(9) line
      {
        name: 'EMA(9)',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ema9,
        symbol: 'none',
        lineStyle: { color: LINE_COLORS.ema9, width: 1.5 },
        z: 2,
      },
      // Histogram bars
      {
        name: 'Histogram',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: histogramData,
        barWidth: '30%',
        z: 0,
        itemStyle: { opacity: 0.35 },
      },
      // Signal line
      {
        name: 'Signal',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: indicators.signal,
        symbol: 'none',
        lineStyle: { color: LINE_COLORS.signal, width: 1.5 },
      },
      // MACD-V scatter points with zone colors
      {
        name: 'MACD-V',
        type: 'scatter',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: indicators.macdV.map((v, i) => ({
          value: [i, v],
          itemStyle: { color: !Number.isNaN(v) ? getMacdVColor(v) : HERMES_COLORS.grayblue },
        })),
        symbolSize: 8,
      },
      // MACD-V connecting line
      {
        name: 'MACD-V Line',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: indicators.macdV,
        symbol: 'none',
        lineStyle: { color: DARK_THEME.textSecondary, width: 1, opacity: 0.5 },
        silent: true,
      },
      // Reference lines
      {
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: Array(times.length).fill(MACD_V_LEVELS.extreme),
        symbol: 'none',
        lineStyle: { color: HERMES_COLORS.red, width: 1, type: 'dashed' },
        silent: true,
      },
      {
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: Array(times.length).fill(MACD_V_LEVELS.neutral),
        symbol: 'none',
        lineStyle: { color: HERMES_COLORS.aqua, width: 1, type: 'dashed', opacity: 0.5 },
        silent: true,
      },
      {
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: Array(times.length).fill(-MACD_V_LEVELS.neutral),
        symbol: 'none',
        lineStyle: { color: HERMES_COLORS.aqua, width: 1, type: 'dashed', opacity: 0.5 },
        silent: true,
      },
      {
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: Array(times.length).fill(-MACD_V_LEVELS.extreme),
        symbol: 'none',
        lineStyle: { color: HERMES_COLORS.red, width: 1, type: 'dashed' },
        silent: true,
      },
    ],
  };

  // Add alert markers
  if (alertMarkers.length > 0) {
    const oversoldMarkers: Array<{ value: [number, number]; itemStyle: { color: string; borderColor: string; borderWidth: number } }> = [];
    const overboughtMarkers: Array<{ value: [number, number]; itemStyle: { color: string; borderColor: string; borderWidth: number } }> = [];

    for (const marker of alertMarkers) {
      // Handle -1 as "last bar"
      const barIndex = marker.barIndex === -1 ? candles.length - 1 : marker.barIndex;

      if (barIndex >= 0 && barIndex < indicators.macdV.length) {
        const alertValue = indicators.macdV[barIndex];
        if (Number.isNaN(alertValue)) continue;

        const isOversold = marker.type === 'oversold';

        // Position triangle above (overbought) or below (oversold) the MACD-V value
        const offset = isOversold ? -25 : 25;
        const markerY = alertValue + offset;

        const markerData = {
          value: [barIndex, markerY] as [number, number],
          itemStyle: {
            color: isOversold ? HERMES_COLORS.lime : HERMES_COLORS.red,
            borderColor: '#ffffff',
            borderWidth: 1,
          },
        };

        if (isOversold) {
          oversoldMarkers.push(markerData);
        } else {
          overboughtMarkers.push(markerData);
        }
      }
    }

    // Add oversold markers (green triangles pointing up)
    if (oversoldMarkers.length > 0) {
      (option.series as echarts.SeriesOption[]).push({
        name: 'Oversold Alert',
        type: 'scatter',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: oversoldMarkers,
        symbol: 'triangle',
        symbolSize: 18,
        symbolRotate: 0,
        z: 10,
      });
    }

    // Add overbought markers (red triangles pointing down)
    if (overboughtMarkers.length > 0) {
      (option.series as echarts.SeriesOption[]).push({
        name: 'Overbought Alert',
        type: 'scatter',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: overboughtMarkers,
        symbol: 'triangle',
        symbolSize: 18,
        symbolRotate: 180,
        z: 10,
      });
    }
  }

  // Render chart
  chart.setOption(option);

  // Export to PNG buffer
  const buffer = canvas.toBuffer('image/png');

  // Cleanup
  chart.dispose();

  return {
    buffer,
    mimeType: 'image/png',
    width,
    height,
    generatedAt: Date.now(),
  };
}
