import { pgTable, serial, varchar, decimal, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users';
import { userExchanges } from './user-exchanges';

/**
 * Positions table - stores user's asset holdings synced from exchanges
 * Tracks quantities, cost basis, and sync timestamps for P&L calculations
 */
export const positions = pgTable(
  'positions',
  {
    id: serial('id').primaryKey(),
    /** User who owns this position */
    userId: serial('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Exchange connection this position is from */
    exchangeId: serial('exchange_id')
      .notNull()
      .references(() => userExchanges.id, { onDelete: 'cascade' }),

    // Asset info
    /** Asset symbol (e.g., 'BTC', 'ETH', 'USD') */
    symbol: varchar('symbol', { length: 20 }).notNull(),
    /** Display name (e.g., 'Bitcoin', 'Ethereum') */
    displayName: varchar('display_name', { length: 100 }),
    /** Coinbase account UUID for this asset */
    coinbaseAccountId: varchar('coinbase_account_id', { length: 100 }),

    // Quantities (high precision for crypto)
    /** Total quantity held */
    quantity: decimal('quantity', { precision: 30, scale: 18 }).notNull(),
    /** Quantity available (not on hold) */
    availableQuantity: decimal('available_quantity', { precision: 30, scale: 18 }),

    // Cost basis for P&L (USD, 2 decimal precision)
    /** Total cost basis in USD */
    costBasis: decimal('cost_basis', { precision: 20, scale: 2 }),

    // Timestamps
    /** Last time this position was synced from exchange */
    lastSyncedAt: timestamp('last_synced_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Index for querying user's positions
    userExchangeIdx: index('positions_user_exchange_idx').on(
      table.userId,
      table.exchangeId
    ),
    // Index for querying specific symbol positions
    symbolIdx: index('positions_symbol_idx').on(
      table.userId,
      table.exchangeId,
      table.symbol
    ),
    // Unique constraint: one position per symbol per user/exchange
    uniqueSymbol: unique('positions_unique_symbol').on(
      table.userId,
      table.exchangeId,
      table.symbol
    ),
  })
);

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
