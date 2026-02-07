/**
 * Seed exchanges table with Coinbase and Binance data
 * Run: npx tsx scripts/seed-exchanges.ts
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { exchanges } from '../packages/database/drizzle/schema';
import { sql } from 'drizzle-orm';

const host = process.env.DATABASE_HOST;
const port = process.env.DATABASE_PORT;
const username = process.env.DATABASE_LIVERMORE_USERNAME;
const password = process.env.DATABASE_LIVERMORE_PASSWORD;
const database = process.env.LIVERMORE_DATABASE_NAME;

if (!host || !port || !username || !password || !database) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const connectionString = `postgresql://${username}:${password}@${host}:${port}/${database}?sslmode=require`;

const pool = new Pool({ connectionString });
const db = drizzle(pool);

async function main() {
  console.log('Checking exchanges table...');

  // Check current data
  const existing = await db.select().from(exchanges);
  console.log(`Found ${existing.length} existing exchanges:`, existing.map(e => e.name));

  if (existing.length === 0) {
    console.log('Inserting seed data...');

    await db.insert(exchanges).values([
      {
        name: 'coinbase',
        displayName: 'Coinbase Advanced Trade',
        wsUrl: 'wss://advanced-trade-ws.coinbase.com',
        restUrl: 'https://api.coinbase.com',
        supportedTimeframes: ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '1d'],
        apiLimits: { ws_connections_per_ip: 750, ws_messages_per_second: 8, rest_weight_limit: 10000 },
        feeSchedule: { base_maker: 0.006, base_taker: 0.012 },
      },
      {
        name: 'binance',
        displayName: 'Binance Spot',
        wsUrl: 'wss://stream.binance.com:9443',
        restUrl: 'https://api.binance.com',
        supportedTimeframes: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'],
        apiLimits: { ws_connections_per_5min: 300, rest_weight_limit: 6000, orders_per_10s: 50 },
        feeSchedule: { base_maker: 0.001, base_taker: 0.001 },
      },
    ]).onConflictDoUpdate({
      target: exchanges.name,
      set: {
        displayName: sql`excluded.display_name`,
        wsUrl: sql`excluded.ws_url`,
        restUrl: sql`excluded.rest_url`,
        supportedTimeframes: sql`excluded.supported_timeframes`,
        apiLimits: sql`excluded.api_limits`,
        feeSchedule: sql`excluded.fee_schedule`,
        updatedAt: sql`now()`,
      },
    });

    console.log('Seed data inserted!');
  }

  // Verify final state
  const final = await db.select().from(exchanges);
  console.log('\nFinal exchanges table:');
  for (const exchange of final) {
    console.log(`  - ${exchange.id}: ${exchange.name} (${exchange.displayName})`);
    console.log(`    WS: ${exchange.wsUrl}`);
    console.log(`    Timeframes: ${JSON.stringify(exchange.supportedTimeframes)}`);
  }

  // Check user_exchanges has exchange_id column
  const result = await db.execute(sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'user_exchanges' AND column_name = 'exchange_id'
  `);
  console.log('\nuser_exchanges.exchange_id column:', result.rows[0] || 'NOT FOUND');

  await pool.end();
}

main().catch(console.error);
