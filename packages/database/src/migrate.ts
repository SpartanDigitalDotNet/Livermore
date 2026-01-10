import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Run database migrations
 *
 * This script should be run during deployment or development setup
 * to apply any pending database schema changes.
 */
async function runMigrations() {
  console.log('🔄 Running database migrations...');

  // Validate only database-specific environment variables
  const requiredEnvVars = {
    DATABASE_LIVERMORE_USERNAME: process.env.DATABASE_LIVERMORE_USERNAME,
    DATABASE_LIVERMORE_PASSWORD: process.env.DATABASE_LIVERMORE_PASSWORD,
    DATABASE_HOST: process.env.DATABASE_HOST,
    DATABASE_PORT: process.env.DATABASE_PORT,
    LIVERMORE_DATABASE_NAME: process.env.LIVERMORE_DATABASE_NAME,
  };

  const missing = Object.entries(requiredEnvVars)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  // Create migration connection
  const connectionString = `postgresql://${requiredEnvVars.DATABASE_LIVERMORE_USERNAME}:${requiredEnvVars.DATABASE_LIVERMORE_PASSWORD}@${requiredEnvVars.DATABASE_HOST}:${requiredEnvVars.DATABASE_PORT}/${requiredEnvVars.LIVERMORE_DATABASE_NAME}`;
  const migrationClient = postgres(connectionString, { max: 1 });

  const db = drizzle(migrationClient);

  try {
    // Run migrations
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await migrationClient.end();
  }
}

// Run migrations if this file is executed directly
runMigrations();
