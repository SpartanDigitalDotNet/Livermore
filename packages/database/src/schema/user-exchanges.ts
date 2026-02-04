import { pgTable, serial, varchar, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * User exchanges table - stores user connections to different exchanges
 * Each user can connect multiple exchanges (Coinbase, Binance, Kraken, etc.)
 *
 * SECURITY: Credentials are NEVER stored in the database.
 * Instead, we store the NAMES of environment variables that contain the secrets.
 * At runtime, the service reads process.env[apiKeyEnvVar] to get the actual key.
 */
export const userExchanges = pgTable(
  'user_exchanges',
  {
    id: serial('id').primaryKey(),
    userId: serial('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Exchange name (e.g., 'coinbase', 'binance', 'kraken') */
    exchangeName: varchar('exchange_name', { length: 50 }).notNull(),
    /** Display name for this connection (user-defined) */
    displayName: varchar('display_name', { length: 100 }),
    /** Name of environment variable containing the API key (e.g., 'COINBASE_API_KEY') */
    apiKeyEnvVar: varchar('api_key_env_var', { length: 100 }).notNull(),
    /** Name of environment variable containing the API secret (e.g., 'COINBASE_API_SECRET') */
    apiSecretEnvVar: varchar('api_secret_env_var', { length: 100 }).notNull(),
    /** Additional credentials env var names as JSON (e.g., {"passphrase": "COINBASE_PASSPHRASE"}) */
    additionalCredentialsEnvVars: text('additional_credentials_env_vars'),
    /** Whether this exchange connection is active */
    isActive: boolean('is_active').default(true).notNull(),
    /** Whether this is the user's default exchange */
    isDefault: boolean('is_default').default(false).notNull(),
    /** Last successful connection timestamp */
    lastConnectedAt: timestamp('last_connected_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('user_exchanges_user_id_idx').on(table.userId),
    userExchangeIdx: index('user_exchanges_user_exchange_idx').on(
      table.userId,
      table.exchangeName
    ),
  })
);

export type UserExchange = typeof userExchanges.$inferSelect;
export type NewUserExchange = typeof userExchanges.$inferInsert;
