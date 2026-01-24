import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6400');

async function check() {
  // Get BTC-USD 1m candles with scores
  const candles = await redis.zrange('candles:1:1:BTC-USD:1m', 0, -1, 'WITHSCORES');
  console.log('BTC-USD 1m candles in Redis:', candles.length / 2, 'total');

  // Parse all
  const parsed = [];
  for (let i = 0; i < candles.length; i += 2) {
    const c = JSON.parse(candles[i]);
    const score = parseInt(candles[i + 1]);
    parsed.push({ ...c, score });
  }

  console.log('\nFirst 5 candles (oldest):');
  for (const c of parsed.slice(0, 5)) {
    console.log(' ', new Date(c.timestamp).toISOString(), 'C:', c.close, 'score:', c.score);
  }

  console.log('\nLast 5 candles (newest):');
  for (const c of parsed.slice(-5)) {
    console.log(' ', new Date(c.timestamp).toISOString(), 'C:', c.close, 'score:', c.score);
  }

  // Check timestamp vs score mismatch
  console.log('\nChecking timestamp vs score consistency...');
  let mismatches = 0;
  for (const c of parsed) {
    if (c.timestamp !== c.score) {
      mismatches++;
      if (mismatches <= 3) {
        console.log('  MISMATCH: timestamp=', c.timestamp, 'score=', c.score);
      }
    }
  }
  console.log('Total mismatches:', mismatches);

  // Check for duplicates (same timestamp)
  const timestamps = parsed.map(c => c.timestamp);
  const uniqueTimestamps = new Set(timestamps);
  console.log('\nUnique timestamps:', uniqueTimestamps.size, 'vs total:', parsed.length);

  // Check gaps
  console.log('\nChecking for gaps (missing minutes)...');
  const sorted = [...parsed].sort((a, b) => a.timestamp - b.timestamp);
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].timestamp - sorted[i - 1].timestamp;
    if (diff !== 60000) {
      gaps++;
      if (gaps <= 5) {
        const gapMin = diff / 60000;
        console.log('  Gap:', new Date(sorted[i - 1].timestamp).toISOString(), '->', gapMin.toFixed(1), 'min');
      }
    }
  }
  console.log('Total gaps:', gaps);

  // Check indicator timestamp
  const indicator = await redis.get('indicator:1:1:BTC-USD:1m:macd-v');
  if (indicator) {
    const data = JSON.parse(indicator);
    console.log('\nIndicator timestamp:', new Date(data.timestamp).toISOString());
    console.log('Latest candle timestamp:', new Date(sorted[sorted.length - 1].timestamp).toISOString());
    console.log('Indicator is', (sorted[sorted.length - 1].timestamp - data.timestamp) / 60000, 'minutes behind');
  }

  await redis.quit();
}

check().catch(console.error);
