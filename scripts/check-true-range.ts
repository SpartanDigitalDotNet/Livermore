import Redis from 'ioredis';

const redis = new Redis(process.env.LIVERMORE_REDIS_URL!);

async function check() {
  const candles = await redis.zrange('candles:1:1:BTC-USD:1m', -30, -1);
  const parsed = candles.map(c => JSON.parse(c));

  console.log('BTC-USD 1m True Range Analysis (last 30 candles):');
  console.log('Time     | H-L      | Gap Up   | Gap Down | True Range | Source');
  console.log('-'.repeat(75));

  let totalTR = 0;
  let gapContributions = 0;

  for (let i = 1; i < parsed.length; i++) {
    const curr = parsed[i];
    const prev = parsed[i - 1];

    const hl = curr.high - curr.low;
    const gapUp = Math.abs(curr.high - prev.close);
    const gapDown = Math.abs(curr.low - prev.close);
    const tr = Math.max(hl, gapUp, gapDown);

    let source = 'H-L';
    if (tr === gapUp && gapUp > hl) source = 'GAP UP';
    if (tr === gapDown && gapDown > hl) source = 'GAP DOWN';

    if (source !== 'H-L') gapContributions++;

    totalTR += tr;

    const time = new Date(curr.timestamp).toISOString().slice(11, 19);
    console.log(
      time,
      '|',
      hl.toFixed(2).padStart(8),
      '|',
      gapUp.toFixed(2).padStart(8),
      '|',
      gapDown.toFixed(2).padStart(8),
      '|',
      tr.toFixed(2).padStart(10),
      '|',
      source
    );
  }

  const avgTR = totalTR / (parsed.length - 1);
  console.log('\nAverage True Range:', avgTR.toFixed(4));
  console.log('Gap-dominated candles:', gapContributions, '/', parsed.length - 1);
  console.log('ATR from indicator:', 11.7962);
  console.log('Ratio (avgTR / indicator ATR):', (avgTR / 11.7962).toFixed(2) + 'x');

  await redis.quit();
}

check().catch(console.error);
