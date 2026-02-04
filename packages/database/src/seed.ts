import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { users, userExchanges } from './schema';

/**
 * Seed database with test user and exchange connection
 *
 * This script creates a test user for development purposes.
 * In production, users will be created via Google OAuth authentication.
 *
 * SECURITY: We store environment variable NAMES, not actual secrets.
 * The actual credentials are read from env vars at runtime.
 */
async function seed() {
  console.log('🌱 Seeding database...');

  // Environment variable names for Coinbase credentials
  // These are the NAMES of the env vars, not the values
  const COINBASE_API_KEY_ENV_VAR = 'Coinbase_ApiKeyId';
  const COINBASE_API_SECRET_ENV_VAR = 'Coinbase_EcPrivateKeyPem';

  // Validate required environment variables for database connection
  const requiredEnvVars = {
    DATABASE_LIVERMORE_USERNAME: process.env.DATABASE_LIVERMORE_USERNAME,
    DATABASE_LIVERMORE_PASSWORD: process.env.DATABASE_LIVERMORE_PASSWORD,
    DATABASE_HOST: process.env.DATABASE_HOST,
    DATABASE_PORT: process.env.DATABASE_PORT,
    LIVERMORE_DATABASE_NAME: process.env.LIVERMORE_DATABASE_NAME,
  };

  // Validate Coinbase credentials exist (but don't store them)
  const coinbaseCredsExist = {
    [COINBASE_API_KEY_ENV_VAR]: process.env[COINBASE_API_KEY_ENV_VAR],
    [COINBASE_API_SECRET_ENV_VAR]: process.env[COINBASE_API_SECRET_ENV_VAR],
  };

  const missing = Object.entries(requiredEnvVars)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  const missingCreds = Object.entries(coinbaseCredsExist)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  if (missingCreds.length > 0) {
    console.warn('⚠️  Missing Coinbase credentials:', missingCreds.join(', '));
    console.warn('   Exchange connection will be created but may not work until credentials are set.');
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
    // SECURITY: We store the NAMES of env vars, NOT the actual credentials
    const [exchange] = await db
      .insert(userExchanges)
      .values({
        userId: user.id,
        exchangeName: 'coinbase',
        displayName: 'Coinbase (Test)',
        apiKeyEnvVar: COINBASE_API_KEY_ENV_VAR,
        apiSecretEnvVar: COINBASE_API_SECRET_ENV_VAR,
        isActive: true,
        isDefault: true,
      })
      .returning();

    console.log('✅ Created Coinbase exchange connection:');
    console.log('   ID:', exchange.id);
    console.log('   Exchange:', exchange.exchangeName);
    console.log('   Display Name:', exchange.displayName);
    console.log('   API Key Env Var:', exchange.apiKeyEnvVar);
    console.log('   API Secret Env Var:', exchange.apiSecretEnvVar);
    console.log('   ⚠️  Credentials read from environment at runtime (not stored in DB)');

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
