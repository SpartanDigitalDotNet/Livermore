/**
 * Load Coinbase positions into database
 * 
 * Fetches current positions from Coinbase and loads them into the
 * public.positions table with user_id=3 and exchange_id=1.
 * 
 * Uses the existing PositionSyncService for consistency with production code.
 */

import { CoinbaseRestClient } from '@livermore/coinbase-client';
import { getDbClient, positions, userExchanges } from '@livermore/database';
import { logger } from '@livermore/utils';
import { eq, and } from 'drizzle-orm';

// Target IDs for sandbox database
const TARGET_USER_ID = 3;
const TARGET_EXCHANGE_ID = 1;

// Currency display names
const CURRENCY_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  USDC: 'USD Coin',
  USDT: 'Tether',
  USD: 'US Dollar',
  DOGE: 'Dogecoin',
  ADA: 'Cardano',
  DOT: 'Polkadot',
  LINK: 'Chainlink',
  AVAX: 'Avalanche',
  MATIC: 'Polygon',
  UNI: 'Uniswap',
  ATOM: 'Cosmos',
  LTC: 'Litecoin',
  XRP: 'Ripple',
};

function getCurrencyDisplayName(symbol: string): string {
  return CURRENCY_NAMES[symbol.toUpperCase()] || symbol;
}

async function loadPositions() {
  console.log('🚀 Starting position load...');
  console.log(`   Target user_id: ${TARGET_USER_ID}`);
  console.log(`   Target exchange_id: ${TARGET_EXCHANGE_ID}\n`);

  // Validate environment variables
  const apiKeyId = process.env.Coinbase_ApiKeyId;
  const privateKeyPem = process.env.Coinbase_EcPrivateKeyPem;

  if (!apiKeyId || !privateKeyPem) {
    console.error('❌ Missing required Coinbase credentials:');
    if (!apiKeyId) console.error('   - Coinbase_ApiKeyId not set');
    if (!privateKeyPem) console.error('   - Coinbase_EcPrivateKeyPem not set');
    process.exit(1);
  }

  // Get database client
  const db = getDbClient();

  // Verify target user and exchange exist
  console.log('🔍 Verifying target user and exchange...');
  
  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, TARGET_USER_ID),
    columns: {
      id: true,
      username: true,
      email: true,
    },
  });

  if (!user) {
    console.error(`❌ User with id=${TARGET_USER_ID} not found in database`);
    console.error('   Please create the user first or update TARGET_USER_ID');
    process.exit(1);
  }
  console.log(`✅ Found user: ${user.username} (${user.email})`);

  const exchange = await db.query.userExchanges.findFirst({
    where: and(
      eq(userExchanges.id, TARGET_EXCHANGE_ID),
      eq(userExchanges.userId, TARGET_USER_ID)
    ),
  });

  if (!exchange) {
    console.error(`❌ Exchange with id=${TARGET_EXCHANGE_ID} not found for user_id=${TARGET_USER_ID}`);
    console.error('   Please create the exchange connection first or update TARGET_EXCHANGE_ID');
    process.exit(1);
  }
  console.log(`✅ Found exchange: ${exchange.exchangeName} (${exchange.displayName})\n`);

  // Create Coinbase client
  console.log('🔌 Connecting to Coinbase...');
  const client = new CoinbaseRestClient(apiKeyId, privateKeyPem);

  // Fetch accounts with balances
  console.log('📊 Fetching accounts from Coinbase...');
  const accounts = await client.getAccountsWithBalance();
  console.log(`   Found ${accounts.length} accounts with balances\n`);

  if (accounts.length === 0) {
    console.log('ℹ️  No accounts with balances found. Nothing to load.');
    return;
  }

  // Get unique symbols
  const symbols = [...new Set(accounts.map(a => a.currency))];
  console.log('💰 Fetching spot prices...');
  const spotPrices = await client.getSpotPrices(symbols);
  console.log(`   Fetched prices for ${spotPrices.size} symbols\n`);

  // Process each account
  console.log('💾 Loading positions into database...\n');
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const account of accounts) {
    const symbol = account.currency;
    const availableBalance = parseFloat(account.available_balance.value);
    const holdBalance = parseFloat(account.hold.value);
    const totalQuantity = availableBalance + holdBalance;

    if (totalQuantity === 0) {
      skippedCount++;
      continue;
    }

    // Get current price
    const price = spotPrices.get(symbol) || 0;
    const currentValue = totalQuantity * price;

    // Check if position already exists
    const existing = await db.query.positions.findFirst({
      where: and(
        eq(positions.userId, TARGET_USER_ID),
        eq(positions.exchangeId, TARGET_EXCHANGE_ID),
        eq(positions.symbol, symbol)
      ),
    });

    // Use existing cost basis if available, otherwise use current value
    const costBasis = existing?.costBasis ? parseFloat(existing.costBasis) : currentValue;

    // Calculate P&L for display
    const unrealizedPnL = currentValue - costBasis;
    const unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;

    // Upsert position
    await db
      .insert(positions)
      .values({
        userId: TARGET_USER_ID,
        exchangeId: TARGET_EXCHANGE_ID,
        symbol,
        displayName: getCurrencyDisplayName(symbol),
        coinbaseAccountId: account.uuid,
        quantity: totalQuantity.toString(),
        availableQuantity: availableBalance.toString(),
        costBasis: costBasis.toString(),
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [positions.userId, positions.exchangeId, positions.symbol],
        set: {
          quantity: totalQuantity.toString(),
          availableQuantity: availableBalance.toString(),
          coinbaseAccountId: account.uuid,
          displayName: getCurrencyDisplayName(symbol),
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    if (existing) {
      updatedCount++;
      console.log(`   ✏️  Updated: ${symbol.padEnd(8)} | Qty: ${totalQuantity.toFixed(8).padStart(18)} | Value: $${currentValue.toFixed(2).padStart(12)} | P&L: ${unrealizedPnLPercent >= 0 ? '+' : ''}${unrealizedPnLPercent.toFixed(2)}%`);
    } else {
      insertedCount++;
      console.log(`   ➕ Inserted: ${symbol.padEnd(8)} | Qty: ${totalQuantity.toFixed(8).padStart(18)} | Value: $${currentValue.toFixed(2).padStart(12)}`);
    }
  }

  console.log('\n✅ Position load completed successfully!');
  console.log(`   📈 Inserted: ${insertedCount}`);
  console.log(`   📝 Updated: ${updatedCount}`);
  console.log(`   ⏭️  Skipped: ${skippedCount}`);
  console.log(`   📊 Total: ${insertedCount + updatedCount} positions in database`);
}

// Run the script
loadPositions()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error loading positions:', error);
    process.exit(1);
  });
