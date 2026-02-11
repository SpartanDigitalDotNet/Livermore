import { pgTable, serial, varchar, timestamp, boolean, numeric, integer, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { exchanges } from './exchanges';

/**
 * Exchange Symbols table - Tier 1 symbols per exchange
 * Phase 25: Top N symbols by 24h volume, shared across users
 * Extended: CoinGecko global rank for universe management
 */
export const exchangeSymbols = pgTable('exchange_symbols', {
  id: serial('id').primaryKey(),
  /** Reference to exchanges table */
  exchangeId: integer('exchange_id').notNull().references(() => exchanges.id, { onDelete: 'cascade' }),
  /** Trading pair symbol (e.g., 'BTC-USD') */
  symbol: varchar('symbol', { length: 20 }).notNull(),
  /** Base currency (e.g., 'BTC') */
  baseCurrency: varchar('base_currency', { length: 10 }).notNull(),
  /** Quote currency (e.g., 'USD') */
  quoteCurrency: varchar('quote_currency', { length: 10 }).notNull(),
  /** 24-hour trading volume in quote currency */
  volume24h: numeric('volume_24h', { precision: 30, scale: 8 }),
  /** Rank by volume (1 = highest) */
  volumeRank: integer('volume_rank'),
  /** CoinGecko market_cap_rank (global ranking) */
  globalRank: integer('global_rank'),
  /** CoinGecko market_cap in USD */
  marketCap: numeric('market_cap', { precision: 30, scale: 2 }),
  /** CoinGecko stable identifier (e.g., "bitcoin") */
  coingeckoId: varchar('coingecko_id', { length: 100 }),
  /** Human-friendly name (e.g., "Bitcoin") */
  displayName: varchar('display_name', { length: 100 }),
  /** Whether symbol is actively monitored */
  isActive: boolean('is_active').default(true).notNull(),
  /** Last time volume data was updated */
  lastVolumeUpdate: timestamp('last_volume_update', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  exchangeSymbolUnique: unique('exchange_symbols_unique').on(table.exchangeId, table.symbol),
  exchangeRankIdx: index('exchange_symbols_exchange_rank_idx')
    .on(table.exchangeId, table.globalRank)
    .where(sql`is_active = true`),
  symbolIdx: index('exchange_symbols_symbol_idx').on(table.symbol),
}));

export type ExchangeSymbol = typeof exchangeSymbols.$inferSelect;
export type NewExchangeSymbol = typeof exchangeSymbols.$inferInsert;
