import { pgTable, serial, varchar, bigint, jsonb, index, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { userExchanges } from './user-exchanges';

/**
 * Indicators table - stores calculated indicator values
 * User-specific and exchange-specific (calculated from user's exchange data)
 */
export const indicators = pgTable(
  'indicators',
  {
    id: serial('id').primaryKey(),
    /** User who owns this indicator data */
    userId: serial('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Exchange connection this indicator is calculated from */
    exchangeId: serial('exchange_id')
      .notNull()
      .references(() => userExchanges.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    timeframe: varchar('timeframe', { length: 5 }).notNull(),
    /** Indicator type (e.g., 'ema', 'macd', 'rsi') */
    type: varchar('type', { length: 20 }).notNull(),
    /** Timestamp of the candle this indicator is calculated for */
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    /** Indicator-specific data stored as JSON */
    value: jsonb('value').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // Index for querying user's indicators
    userExchangeIdx: index('indicators_user_exchange_idx').on(
      table.userId,
      table.exchangeId
    ),
    // Index for querying specific indicator type
    userSymbolTimeframeTypeIdx: index('indicators_user_symbol_timeframe_type_idx').on(
      table.userId,
      table.exchangeId,
      table.symbol,
      table.timeframe,
      table.type
    ),
    // Index for timestamp queries
    timestampIdx: index('indicators_timestamp_idx').on(table.timestamp),
  })
);

export type Indicator = typeof indicators.$inferSelect;
export type NewIndicator = typeof indicators.$inferInsert;
