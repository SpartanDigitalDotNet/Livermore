import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { HARDCODED_CONFIG, type EnvConfig } from '@livermore/schemas';
import { createLogger, validateEnv } from '@livermore/utils';
import * as schema from './schema';

const logger = createLogger('database');

/**
 * Create a database client instance
 *
 * @param config - Validated environment configuration
 * @returns Drizzle ORM instance
 */
export function createDbClient(config: EnvConfig) {
  logger.info('Connecting to PostgreSQL database...');

  // Build PostgreSQL connection string from environment variables
  const connectionString = `postgresql://${config.DATABASE_LIVERMORE_USERNAME}:${config.DATABASE_LIVERMORE_PASSWORD}@${config.DATABASE_HOST}:${config.DATABASE_PORT}/${config.LIVERMORE_DATABASE_NAME}`;

  const queryClient = postgres(connectionString, {
    max: HARDCODED_CONFIG.database.poolSize,
    connect_timeout: HARDCODED_CONFIG.database.connectionTimeoutMs / 1000,
    ssl: 'require', // Always use SSL - no exceptions
    onnotice: () => {}, // Suppress notices in logs
  });

  // Create Drizzle instance with schema
  const db = drizzle(queryClient, { schema });

  logger.info('Database connection established');

  return db;
}

/**
 * Helper type for database instance
 */
export type Database = ReturnType<typeof createDbClient>;

/**
 * Test database connection with a simple query
 * Throws an error if connection fails
 */
export async function testDatabaseConnection(db: Database): Promise<void> {
  try {
    // Simple query to verify connection works
    await db.execute(sql`SELECT 1`);
    logger.info('Database connection test passed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Database connection test FAILED');
    throw new Error(`Database connection failed: ${message}`);
  }
}

/**
 * Singleton database client instance
 */
let dbInstance: Database | null = null;

/**
 * Get or create the database client instance
 *
 * Uses singleton pattern to ensure only one connection pool exists
 */
export function getDbClient(): Database {
  if (!dbInstance) {
    const config = validateEnv();
    dbInstance = createDbClient(config);
  }
  return dbInstance;
}
