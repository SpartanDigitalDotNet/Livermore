/**
 * ECharts MACD-V Chart Spike
 *
 * Tests server-side chart generation with:
 * - Dark theme
 * - Two-panel layout (Price + MACD-V)
 * - Hermes color zones
 */

const echarts = require('echarts');
const { createCanvas } = require('canvas');
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

// Generate mock data (25 bars simulating 1m timeframe)
// Scenario: Deep oversold (-280) recovering through all zones
function generateMockData() {
  const now = new Date();
  const data = [];

  // Starting price around 95000 (BTC-like)
  let price = 94000;
  let macdV = -280; // Start extremely oversold
  let signal = -260;

  for (let i = 24; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60000);
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // Simulate strong price recovery
    const priceChange = (Math.random() - 0.2) * 200; // Strong upward bias
    price += priceChange;

    // Calculate mock OHLC
    const open = price - (Math.random() * 60);
    const high = Math.max(open, price) + (Math.random() * 50);
    const low = Math.min(open, price) - (Math.random() * 50);
    const close = price;

    // Calculate EMA(9) - lags behind price
    const ema9 = price - (Math.random() - 0.3) * 100;

    // Simulate MACD-V recovery from deeply oversold (-280) toward neutral
    // This shows the full color spectrum
    macdV += (Math.random() * 25) - 3; // Strong upward trend
    signal += (macdV - signal) * 0.12; // Signal follows slowly
    const histogram = macdV - signal;

    data.push({
      time: timeStr,
      open,
      high,
      low,
      close,
      ema9,
      macdV,
      signal,
      histogram,
    });
  }

  return data;
}

// Create the chart
function createMacdVChart(data, symbol = 'BTC-USD', timeframe = '1m') {
  // Create canvas
  const canvas = createCanvas(800, 500);

  // Initialize ECharts with canvas
  const chart = echarts.init(canvas);

  // Extract data series
  const times = data.map(d => d.time);
  const prices = data.map(d => d.close);
  const ema9 = data.map(d => d.ema9);
  const macdV = data.map(d => d.macdV);
  const signals = data.map(d => d.signal);
  // Histogram bars colored by magnitude (Hermes zones)
  const histogramData = data.map((d, i) => ({
    value: d.histogram,
    itemStyle: {
      color: getMacdVColor(d.histogram), // Color by magnitude
    }
  }));

  // MACD-V line with color segments based on zones
  const macdVWithColors = data.map((d, i) => ({
    value: d.macdV,
    itemStyle: {
      color: getMacdVColor(d.macdV),
    }
  }));

  const option = {
    backgroundColor: DARK_THEME.background,

    title: [
      {
        text: `${symbol} - Price - EMA(9)`,
        left: 'center',
        top: 5,
        textStyle: {
          color: DARK_THEME.text,
          fontSize: 14,
          fontWeight: 'normal',
        }
      },
      {
        text: `MACD-V (12,26,9)`,
        left: 'center',
        top: '52%',
        textStyle: {
          color: DARK_THEME.text,
          fontSize: 12,
          fontWeight: 'normal',
        }
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
      { // Price chart
        left: 60,
        right: 20,
        top: 50,
        height: '35%',
      },
      { // MACD-V chart
        left: 60,
        right: 20,
        top: '60%',
        height: '32%',
      }
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
        axisLabel: {
          color: DARK_THEME.textSecondary,
          fontSize: 9,
          interval: 4,
        },
        axisTick: { show: false },
      }
    ],

    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        scale: true, // Auto-scale to data range
        splitLine: { lineStyle: { color: DARK_THEME.grid, type: 'dashed' } },
        axisLine: { lineStyle: { color: DARK_THEME.axisLine } },
        axisLabel: {
          color: DARK_THEME.textSecondary,
          fontSize: 9,
          formatter: (v) => v.toFixed(0),
        },
      },
      {
        type: 'value',
        gridIndex: 1,
        splitLine: { lineStyle: { color: DARK_THEME.grid, type: 'dashed' } },
        axisLine: { lineStyle: { color: DARK_THEME.axisLine } },
        axisLabel: {
          color: DARK_THEME.textSecondary,
          fontSize: 9,
        },
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
        smooth: false,
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
        smooth: false,
      },
      // Histogram bars (subtle, behind other elements)
      {
        name: 'Histogram',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: histogramData,
        barWidth: '40%',
        barGap: '10%',
        z: 1, // Behind other elements
        itemStyle: {
          opacity: 0.7,
        },
      },
      // Signal line
      {
        name: 'Signal',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: signals,
        symbol: 'none',
        lineStyle: { color: '#ffaa00', width: 1.5 },
        smooth: false,
      },
      // MACD-V as scatter points with zone colors
      {
        name: 'MACD-V',
        type: 'scatter',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: data.map((d, i) => ({
          value: [i, d.macdV],
          itemStyle: { color: getMacdVColor(d.macdV) },
        })),
        symbolSize: 8,
      },
      // MACD-V connecting line (subtle)
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
      // Reference lines at +150, +50, -50, -150
      {
        name: 'Level +150',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: Array(times.length).fill(150),
        symbol: 'none',
        lineStyle: { color: HERMES_COLORS.red, width: 1, type: 'dashed' },
        silent: true,
      },
      {
        name: 'Level +50',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: Array(times.length).fill(50),
        symbol: 'none',
        lineStyle: { color: HERMES_COLORS.aqua, width: 1, type: 'dashed', opacity: 0.5 },
        silent: true,
      },
      {
        name: 'Level -50',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: Array(times.length).fill(-50),
        symbol: 'none',
        lineStyle: { color: HERMES_COLORS.aqua, width: 1, type: 'dashed', opacity: 0.5 },
        silent: true,
      },
      {
        name: 'Level -150',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
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

// Main execution
async function main() {
  console.log('Generating mock data...');
  const data = generateMockData();

  console.log('Creating chart...');
  const chart = createMacdVChart(data);

  console.log('Exporting to PNG...');
  const buffer = chart.getDom().toBuffer('image/png');

  const outputPath = './macdv-chart-spike.png';
  fs.writeFileSync(outputPath, buffer);

  console.log(`Chart saved to: ${outputPath}`);
  console.log('Done!');

  // Cleanup
  chart.dispose();
}

main().catch(console.error);
