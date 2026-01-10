import { pgTable, serial, varchar, decimal, bigint, index, timestamp, unique } from 'drizzle-orm/pg-core';
import { users } from './users';
import { userExchanges } from './user-exchanges';

/**
 * Candles table - stores OHLCV candlestick data
 * User-specific and exchange-specific (different exchanges = different data)
 */
export const candles = pgTable(
  'candles',
  {
    id: serial('id').primaryKey(),
    /** User who owns this candle data */
    userId: serial('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Exchange connection this candle came from */
    exchangeId: serial('exchange_id')
      .notNull()
      .references(() => userExchanges.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    timeframe: varchar('timeframe', { length: 5 }).notNull(),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    open: decimal('open', { precision: 20, scale: 8 }).notNull(),
    high: decimal('high', { precision: 20, scale: 8 }).notNull(),
    low: decimal('low', { precision: 20, scale: 8 }).notNull(),
    close: decimal('close', { precision: 20, scale: 8 }).notNull(),
    volume: decimal('volume', { precision: 20, scale: 8 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // Index for querying user's candles
    userExchangeIdx: index('candles_user_exchange_idx').on(
      table.userId,
      table.exchangeId
    ),
    // Index for querying specific symbol/timeframe
    userSymbolTimeframeIdx: index('candles_user_symbol_timeframe_idx').on(
      table.userId,
      table.exchangeId,
      table.symbol,
      table.timeframe
    ),
    // Index for timestamp queries
    timestampIdx: index('candles_timestamp_idx').on(table.timestamp),
    // Ensure no duplicate candles per user/exchange/symbol/timeframe/timestamp
    uniqueCandle: unique('candles_unique').on(
      table.userId,
      table.exchangeId,
      table.symbol,
      table.timeframe,
      table.timestamp
    ),
  })
);

export type Candle = typeof candles.$inferSelect;
export type NewCandle = typeof candles.$inferInsert;
