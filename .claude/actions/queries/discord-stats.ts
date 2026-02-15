/**
 * Query Action: discord-stats
 *
 * Show Discord bot usage stats from Redis.
 * Covers total commands, per-user breakdown, daily activity, and command popularity.
 *
 * Usage:
 *   npx tsx .claude/actions/queries/discord-stats.ts              # full stats
 *   npx tsx .claude/actions/queries/discord-stats.ts --users      # user breakdown only
 *   npx tsx .claude/actions/queries/discord-stats.ts --daily      # daily activity only
 *   npx tsx .claude/actions/queries/discord-stats.ts --commands   # command popularity only
 */
import { getRedisClient } from '@livermore/cache';

async function main() {
  const args = process.argv.slice(2);
  const showUsers = args.includes('--users');
  const showDaily = args.includes('--daily');
  const showCommands = args.includes('--commands');
  const showAll = !showUsers && !showDaily && !showCommands;

  const redis = getRedisClient();

  // Total commands
  const total = await redis.get('discord:total_commands');
  console.log(`=== DISCORD BOT STATS ===\n`);
  console.log(`Total commands: ${total ?? 0}`);

  // Discover all keys
  const allKeys = await redis.keys('discord:*');

  // --- USERS ---
  if (showAll || showUsers) {
    const userKeys = allKeys.filter(k => k.startsWith('discord:users:'));
    const users: { username: string; total: number; lastSeen: string; lastCmd: string; cmds: Record<string, string> }[] = [];

    for (const k of userKeys) {
      const data = await redis.hgetall(k);
      const username = data.username || k.split(':').pop()?.replace(/[{}]/g, '') || '?';

      // Get per-user command breakdown
      const cmdKey = `discord:user_cmds:{${username}}`;
      const cmds = allKeys.includes(cmdKey) ? await redis.hgetall(cmdKey) : {};

      users.push({
        username,
        total: parseInt(data.total_commands || '0', 10),
        lastSeen: data.last_seen?.split('T')[0] ?? '?',
        lastCmd: data.last_command ?? '?',
        cmds,
      });
    }

    users.sort((a, b) => b.total - a.total);

    console.log(`\n--- USERS (${users.length}) ---`);
    for (const u of users) {
      const topCmds = Object.entries(u.cmds)
        .sort(([, a], [, b]) => parseInt(b) - parseInt(a))
        .slice(0, 3)
        .map(([cmd, n]) => `${cmd}(${n})`)
        .join(', ');
      console.log(`  ${u.username.padEnd(25)} ${String(u.total).padStart(4)} cmds  last: ${u.lastSeen}  top: ${topCmds}`);
    }
  }

  // --- DAILY ACTIVITY ---
  if (showAll || showDaily) {
    const dailyKeys = allKeys
      .filter(k => k.startsWith('discord:cmd_counts:'))
      .sort();

    console.log(`\n--- DAILY ACTIVITY ---`);
    let grandTotal = 0;
    for (const k of dailyKeys) {
      const date = k.replace('discord:cmd_counts:', '');
      const counts = await redis.hgetall(k);
      const dayTotal = Object.values(counts).reduce((sum, n) => sum + parseInt(n, 10), 0);
      grandTotal += dayTotal;

      const topCmds = Object.entries(counts)
        .sort(([, a], [, b]) => parseInt(b) - parseInt(a))
        .slice(0, 4)
        .map(([cmd, n]) => `${cmd}(${n})`)
        .join(', ');
      console.log(`  ${date}  ${String(dayTotal).padStart(3)} cmds  ${topCmds}`);
    }

    // Days since last activity
    if (dailyKeys.length > 0) {
      const lastDate = dailyKeys[dailyKeys.length - 1].replace('discord:cmd_counts:', '');
      const daysSince = Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000);
      if (daysSince > 1) {
        console.log(`\n  ⚠ No activity for ${daysSince} days (last: ${lastDate})`);
      }
    }
  }

  // --- COMMAND POPULARITY ---
  if (showAll || showCommands) {
    const dailyKeys = allKeys.filter(k => k.startsWith('discord:cmd_counts:'));
    const cmdTotals: Record<string, number> = {};

    for (const k of dailyKeys) {
      const counts = await redis.hgetall(k);
      for (const [cmd, n] of Object.entries(counts)) {
        cmdTotals[cmd] = (cmdTotals[cmd] || 0) + parseInt(n, 10);
      }
    }

    const sorted = Object.entries(cmdTotals).sort(([, a], [, b]) => b - a);
    const totalCmds = sorted.reduce((sum, [, n]) => sum + n, 0);

    console.log(`\n--- COMMAND POPULARITY ---`);
    for (const [cmd, n] of sorted) {
      const pct = ((n / totalCmds) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(n / 2));
      console.log(`  ${cmd.padEnd(15)} ${String(n).padStart(3)} (${pct.padStart(5)}%)  ${bar}`);
    }
  }

  await redis.quit();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
