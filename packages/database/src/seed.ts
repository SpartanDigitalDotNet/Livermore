import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { users, userExchanges } from './schema';

/**
 * Seed database with test user and exchange connection
 *
 * This script creates a test user for development purposes.
 * In production, users will be created via Google OAuth authentication.
 */
async function seed() {
  console.log('🌱 Seeding database...');

  // Validate required environment variables
  const requiredEnvVars = {
    DATABASE_LIVERMORE_USERNAME: process.env.DATABASE_LIVERMORE_USERNAME,
    DATABASE_LIVERMORE_PASSWORD: process.env.DATABASE_LIVERMORE_PASSWORD,
    DATABASE_HOST: process.env.DATABASE_HOST,
    DATABASE_PORT: process.env.DATABASE_PORT,
    LIVERMORE_DATABASE_NAME: process.env.LIVERMORE_DATABASE_NAME,
    Coinbase_ApiKeyId: process.env.Coinbase_ApiKeyId,
    Coinbase_EcPrivateKeyPem: process.env.Coinbase_EcPrivateKeyPem,
  };

  const missing = Object.entries(requiredEnvVars)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  // Create database connection
  const connectionString = `postgresql://${requiredEnvVars.DATABASE_LIVERMORE_USERNAME}:${requiredEnvVars.DATABASE_LIVERMORE_PASSWORD}@${requiredEnvVars.DATABASE_HOST}:${requiredEnvVars.DATABASE_PORT}/${requiredEnvVars.LIVERMORE_DATABASE_NAME}`;
  const client = postgres(connectionString, {
    ssl: 'require', // Always use SSL - no exceptions
  });
  const db = drizzle(client);

  try {
    // Check if test user already exists
    const existingUsers = await db.select().from(users).where(eq(users.username, 'testuser'));

    if (existingUsers.length > 0) {
      console.log('ℹ️  Test user already exists, skipping seed');
      console.log('   User ID:', existingUsers[0].id);

      // Check if exchange exists
      const existingExchanges = await db.select().from(userExchanges).where(eq(userExchanges.userId, existingUsers[0].id));
      if (existingExchanges.length > 0) {
        console.log('   Exchange ID:', existingExchanges[0].id);
      }

      return;
    }

    // Create test user
    const [user] = await db
      .insert(users)
      .values({
        username: 'testuser',
        email: 'test@livermore.dev',
        isActive: true,
      })
      .returning();

    console.log('✅ Created test user:');
    console.log('   ID:', user.id);
    console.log('   Username:', user.username);
    console.log('   Email:', user.email);

    // Create Coinbase exchange connection for test user
    const [exchange] = await db
      .insert(userExchanges)
      .values({
        userId: user.id,
        exchangeName: 'coinbase',
        displayName: 'Coinbase (Test)',
        apiKey: requiredEnvVars.Coinbase_ApiKeyId!,
        apiSecret: requiredEnvVars.Coinbase_EcPrivateKeyPem!,
        isActive: true,
        isDefault: true,
      })
      .returning();

    console.log('✅ Created Coinbase exchange connection:');
    console.log('   ID:', exchange.id);
    console.log('   Exchange:', exchange.exchangeName);
    console.log('   Display Name:', exchange.displayName);

    console.log('\n🎉 Seed completed successfully!');
    console.log('\n📝 Development User Credentials:');
    console.log('   User ID:', user.id);
    console.log('   Exchange ID:', exchange.id);
    console.log('\n💡 Use these IDs for development and testing.');

  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run seed if this file is executed directly
seed();
