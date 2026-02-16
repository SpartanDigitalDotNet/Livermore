import { getRedisClient } from '@livermore/cache';

async function main() {
  const redis = getRedisClient();
  await new Promise(r => setTimeout(r, 2000));

  for (const sym of ['BTC-USD', 'ENA-USD']) {
  const key = `candles:1:${sym}:1m`;
  const all = await redis.zrangebyscore(key, '-inf', '+inf', 'WITHSCORES');

  const timestamps: number[] = [];
  for (let i = 1; i < all.length; i += 2) {
    timestamps.push(parseInt(all[i]));
  }
  timestamps.sort((a, b) => a - b);

  const span = Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 60000);
  const expected = span + 1;
  console.log(`\n=== ${sym} 1m ===`);
  console.log('Total candles:', timestamps.length);
  console.log('First:', new Date(timestamps[0]).toISOString());
  console.log('Last:', new Date(timestamps[timestamps.length - 1]).toISOString());
  console.log('Span:', span, 'min | Expected:', expected);

  const gaps: { after: number; before: number; missing: number }[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const diff = timestamps[i] - timestamps[i - 1];
    if (diff > 60000) {
      gaps.push({ after: timestamps[i - 1], before: timestamps[i], missing: Math.round(diff / 60000) - 1 });
    }
  }

  const totalMissing = gaps.reduce((s, g) => s + g.missing, 0);
  const gapRate = ((totalMissing / expected) * 100).toFixed(1);
  if (gaps.length === 0) {
    console.log('Gaps: NONE — continuous 1m data');
  } else {
    console.log(`Gaps: ${gaps.length} | Missing: ${totalMissing} candles (${gapRate}%)`);
    const big = gaps.filter(g => g.missing >= 3);
    if (big.length > 0) {
      console.log('Largest gaps:');
      for (const g of big.sort((a, b) => b.missing - a.missing).slice(0, 5)) {
        console.log(`  ${new Date(g.after).toISOString()} → ${new Date(g.before).toISOString()} (${g.missing} min)`);
      }
    }
  }
  } // end for loop

  await redis.quit();
}
main().catch(e => { console.error(e); process.exit(1); });
