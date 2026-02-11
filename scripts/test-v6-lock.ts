import { validateEnv } from '@livermore/utils';
import { createRedisClient, instanceStatusKey } from '@livermore/cache';

async function main() {
  const config = validateEnv();
  const redis = createRedisClient(config);

  // Wait for connection
  await new Promise<void>((resolve) => {
    redis.on('ready', resolve);
    // If already ready
    setTimeout(resolve, 3000);
  });

  const fakePayload = JSON.stringify({
    exchangeId: 1,
    exchangeName: 'coinbase',
    hostname: 'FAKE-ATTACKER-HOST',
    ipAddress: '1.2.3.4',
    adminEmail: 'attacker@evil.com',
    adminDisplayName: 'Attacker',
    connectionState: 'idle',
    symbolCount: 0,
    connectedAt: null,
    lastHeartbeat: new Date().toISOString(),
    lastStateChange: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    lastError: null,
    lastErrorAt: null,
  });

  // ===== TEST 1: Try to claim exchange 1 (already held) =====
  console.log('=== TEST 1: Attempt to claim exchange 1 (already held by running API) ===');
  const key1 = instanceStatusKey(1);
  const result1 = await redis.set(key1, fakePayload, 'EX', 45, 'NX');
  if (result1 === null) {
    console.log('PASS: SET NX returned null — lock held, claim rejected');

    // Read the existing holder's info (what LOCK-04 conflict message would show)
    const existing = await redis.get(key1);
    const ttl = await redis.ttl(key1);
    if (existing) {
      const holder = JSON.parse(existing);
      console.log(`  Lock holder: ${holder.hostname} (${holder.ipAddress})`);
      console.log(`  Connected at: ${holder.connectedAt}`);
      console.log(`  State: ${holder.connectionState}`);
      console.log(`  TTL remaining: ${ttl}s`);
      console.log(`  Conflict message would be:`);
      console.log(`  "Exchange 1 (coinbase) is already claimed by ${holder.hostname} (${holder.ipAddress}) since ${holder.connectedAt}. Stop that instance first, or wait for TTL to expire (${ttl}s remaining)."`);
    }
  } else {
    console.log('FAIL: SET NX returned OK — lock was NOT held! This is a bug.');
    // Clean up our accidental claim
    await redis.del(key1);
  }

  // ===== TEST 2: Try to claim exchange 99 (no one holds it) =====
  console.log('\n=== TEST 2: Attempt to claim exchange 99 (unclaimed) ===');
  const key99 = instanceStatusKey(99);
  const fakePayload99 = JSON.stringify({
    ...JSON.parse(fakePayload),
    exchangeId: 99,
    exchangeName: 'test-exchange',
  });
  const result99 = await redis.set(key99, fakePayload99, 'EX', 10, 'NX');
  if (result99 === 'OK') {
    console.log('PASS: SET NX returned OK — unclaimed exchange was successfully claimed');
    const ttl99 = await redis.ttl(key99);
    console.log(`  Key created: ${key99} with TTL ${ttl99}s`);

    // Verify we can read it back
    const readback = await redis.get(key99);
    if (readback) {
      const parsed = JSON.parse(readback);
      console.log(`  Readback: exchangeId=${parsed.exchangeId}, hostname=${parsed.hostname}`);
    }

    // Now try a SECOND claim on 99 (should fail since we just claimed it)
    console.log('\n=== TEST 3: Second claim on exchange 99 (just claimed) ===');
    const result99b = await redis.set(key99, fakePayload99, 'EX', 10, 'NX');
    if (result99b === null) {
      console.log('PASS: Second SET NX on same key returned null — double-claim prevented');
    } else {
      console.log('FAIL: Second SET NX returned OK — race condition!');
    }

    // Clean up
    await redis.del(key99);
    console.log('  Cleaned up test key exchange:99:status');
  } else {
    console.log('FAIL: SET NX returned null for unclaimed exchange — something is wrong');
  }

  // ===== TEST 4: Verify heartbeat XX pattern (only write if key exists) =====
  console.log('\n=== TEST 4: Heartbeat XX pattern on non-existent key ===');
  const ghostKey = instanceStatusKey(999);
  const resultXX = await redis.set(ghostKey, fakePayload, 'EX', 45, 'XX');
  if (resultXX === null) {
    console.log('PASS: SET XX on missing key returned null — heartbeat cannot create ghost keys');
  } else {
    console.log('FAIL: SET XX created a key that did not exist — ghost key vulnerability');
    await redis.del(ghostKey);
  }

  console.log('\n=== ALL TESTS COMPLETE ===');
  await redis.quit();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
