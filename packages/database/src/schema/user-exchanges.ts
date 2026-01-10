import { pgTable, serial, varchar, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * User exchanges table - stores user connections to different exchanges
 * Each user can connect multiple exchanges (Coinbase, Binance, Kraken, etc.)
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
    /** API key or key ID */
    apiKey: varchar('api_key', { length: 500 }).notNull(),
    /** API secret or private key (encrypted/hashed in production) */
    apiSecret: text('api_secret').notNull(),
    /** Additional credentials (e.g., passphrase for Coinbase) as JSON */
    additionalCredentials: text('additional_credentials'),
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
