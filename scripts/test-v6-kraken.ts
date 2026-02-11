import { validateEnv } from '@livermore/utils';
import { createRedisClient, testRedisConnection, instanceStatusKey, networkActivityStreamKey } from '@livermore/cache';

async function main() {
  const config = validateEnv();
  const redis = createRedisClient(config);

  await testRedisConnection(redis);

  const exchangeId = 4;
  const exchangeName = 'kraken';
  const hostname = 'CLAUDE-TEST-NODE';
  const ip = '10.0.0.99';
  const adminEmail = 'mike@livermore.dev';
  const key = instanceStatusKey(exchangeId);
  const streamKey = networkActivityStreamKey(exchangeName);
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

  async function logTransition(from: string, to: string) {
    const minId = `${Date.now() - NINETY_DAYS_MS}-0`;
    await redis.xadd(streamKey, 'MINID', '~', minId, '*',
      'event', 'state_transition',
      'timestamp', new Date().toISOString(),
      'fromState', from, 'toState', to,
      'exchangeId', String(exchangeId),
      'exchangeName', exchangeName,
      'hostname', hostname,
      'ip', ip, 'adminEmail', adminEmail);
  }

  // Claim the key
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    exchangeId, exchangeName, hostname, ipAddress: ip,
    adminEmail, adminDisplayName: 'Mike',
    connectionState: 'active', symbolCount: 8,
    connectedAt: now, lastHeartbeat: now,
    lastStateChange: now, registeredAt: now,
    lastError: null, lastErrorAt: null,
  });

  const result = await redis.set(key, payload, 'EX', 60, 'NX');
  if (result !== 'OK') {
    console.log('Could not claim exchange 4 — already held or TTL not expired yet.');
    await redis.quit();
    process.exit(0);
  }

  // Write activity stream entries
  await logTransition('idle', 'starting');
  await new Promise(r => setTimeout(r, 200));
  await logTransition('starting', 'warming');
  await new Promise(r => setTimeout(r, 200));
  await logTransition('warming', 'active');

  console.log('Exchange 4 (kraken) claimed with 3 activity entries. TTL: 60s');
  console.log('Check Admin now — instance card + activity feed.');
  console.log('Waiting 60s...');
  await new Promise(r => setTimeout(r, 60000));
  console.log('TTL expired. Done.');
  await redis.quit();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
