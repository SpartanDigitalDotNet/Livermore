/**
 * Test Redis Pub/Sub on Azure Redis
 *
 * Tests end-to-end publish/subscribe functionality.
 * Requires REDIS_URL environment variable to be set.
 */

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error('❌ REDIS_URL environment variable not set');
  process.exit(1);
}

const TEST_CHANNEL = 'test:pubsub:channel';
const TEST_MESSAGE = JSON.stringify({
  test: 'Hello from Livermore',
  timestamp: Date.now(),
  source: 'pub-sub-test',
});

// Parse host for TLS servername
const hostMatch = REDIS_URL.match(/@([^:]+):/);
const host = hostMatch?.[1];

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║  Redis Pub/Sub Test - Azure                         ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

console.log('📡 Connection Details:');
console.log('   Host:', host || 'unknown');
console.log('   Channel:', TEST_CHANNEL);
console.log('');

// Create two Redis clients (one for publish, one for subscribe)
const subscriber = new Redis(REDIS_URL, {
  tls: host ? { servername: host } : undefined,
  lazyConnect: true,
});

const publisher = new Redis(REDIS_URL, {
  tls: host ? { servername: host } : undefined,
  lazyConnect: true,
});

let messageReceived = false;

async function runTest() {
  try {
    // Connect both clients
    console.log('🔌 Connecting subscriber...');
    await subscriber.connect();
    console.log('✅ Subscriber connected\n');

    console.log('🔌 Connecting publisher...');
    await publisher.connect();
    console.log('✅ Publisher connected\n');

    // Subscribe to channel
    console.log('📥 Subscribing to channel:', TEST_CHANNEL);
    await subscriber.subscribe(TEST_CHANNEL);
    console.log('✅ Subscribed successfully\n');

    // Set up message handler
    subscriber.on('message', (channel, message) => {
      console.log('📨 Message received!');
      console.log('   Channel:', channel);
      console.log('   Message:', message);
      console.log('');

      if (channel === TEST_CHANNEL && message === TEST_MESSAGE) {
        messageReceived = true;
        console.log('✅ Message matches expected content!\n');
      } else {
        console.log('⚠️  Message content mismatch\n');
      }
    });

    // Wait a moment for subscription to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Publish test message
    console.log('📤 Publishing test message...');
    console.log('   Content:', TEST_MESSAGE);
    const numSubscribers = await publisher.publish(TEST_CHANNEL, TEST_MESSAGE);
    console.log(`✅ Published to ${numSubscribers} subscriber(s)\n`);

    // Wait for message to be received
    console.log('⏳ Waiting for message to be received...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check results
    if (messageReceived) {
      console.log('╔══════════════════════════════════════════════════════╗');
      console.log('║  ✅ Pub/Sub Test PASSED                              ║');
      console.log('╚══════════════════════════════════════════════════════╝');
      process.exit(0);
    } else {
      console.log('╔══════════════════════════════════════════════════════╗');
      console.log('║  ❌ Pub/Sub Test FAILED - Message not received       ║');
      console.log('╚══════════════════════════════════════════════════════╝');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  } finally {
    // Cleanup
    await subscriber.quit();
    await publisher.quit();
  }
}

// Run the test
runTest();
