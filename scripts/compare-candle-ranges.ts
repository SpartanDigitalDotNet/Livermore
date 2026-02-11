import Redis from 'ioredis';

const redis = new Redis(process.env.LIVERMORE_REDIS_URL!);

async function analyzeSymbol(symbol: string) {
  const candles = await redis.zrange(`candles:1:1:${symbol}:1m`, -60, -1);

  if (candles.length === 0) {
    console.log(`${symbol}: No candles`);
    return null;
  }

  const parsed = candles.map(c => JSON.parse(c));

  // Calculate average range as percentage of price
  let totalRangePct = 0;
  for (const c of parsed) {
    const range = c.high - c.low;
    const rangePct = (range / c.close) * 100;
    totalRangePct += rangePct;
  }
  const avgRangePct = totalRangePct / parsed.length;

  // Get indicator ATR
  const indicator = await redis.get(`indicator:1:1:${symbol}:1m:macd-v`);
  let atr = null;
  let atrPct = null;
  if (indicator) {
    const data = JSON.parse(indicator);
    atr = data.value.atr;
    const lastPrice = parsed[parsed.length - 1].close;
    atrPct = (atr / lastPrice) * 100;
  }

  return { symbol, avgRangePct, atr, atrPct, candleCount: parsed.length };
}

async function main() {
  const symbols = ['BTC-USD', 'ETH-USD', 'XRP-USD', 'LINK-USD', 'ONDO-USD'];

  console.log('Symbol       | Avg Range % | ATR      | ATR %    | Candles');
  console.log('-'.repeat(65));

  for (const symbol of symbols) {
    const result = await analyzeSymbol(symbol);
    if (result) {
      console.log(
        result.symbol.padEnd(12),
        '|',
        result.avgRangePct.toFixed(4).padStart(10),
        '%|',
        result.atr?.toFixed(4).padStart(8) || 'N/A'.padStart(8),
        '|',
        result.atrPct?.toFixed(4).padStart(7) + '%' || 'N/A'.padStart(8),
        '|',
        result.candleCount
      );
    }
  }

  // Also show last 5 BTC candle ranges vs ETH
  console.log('\n\nLast 10 candle ranges (as % of close):');
  console.log('BTC-USD vs ETH-USD');
  console.log('-'.repeat(50));

  const btcCandles = await redis.zrange('candles:1:1:BTC-USD:1m', -10, -1);
  const ethCandles = await redis.zrange('candles:1:1:ETH-USD:1m', -10, -1);

  for (let i = 0; i < Math.min(btcCandles.length, ethCandles.length); i++) {
    const btc = JSON.parse(btcCandles[i]);
    const eth = JSON.parse(ethCandles[i]);

    const btcRangePct = ((btc.high - btc.low) / btc.close) * 100;
    const ethRangePct = ((eth.high - eth.low) / eth.close) * 100;

    const time = new Date(btc.timestamp).toISOString().slice(11, 19);
    console.log(
      time,
      '| BTC:',
      btcRangePct.toFixed(4) + '%',
      '| ETH:',
      ethRangePct.toFixed(4) + '%',
      '| Ratio:',
      (btcRangePct / ethRangePct).toFixed(2) + 'x'
    );
  }

  await redis.quit();
}

main().catch(console.error);
