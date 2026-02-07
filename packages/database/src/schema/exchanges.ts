import { pgTable, serial, varchar, timestamp, boolean, jsonb, unique } from 'drizzle-orm/pg-core';

/**
 * Exchanges table - stores exchange metadata and configuration
 * Phase 23: Created as part of multi-exchange architecture
 */
export const exchanges = pgTable('exchanges', {
  id: serial('id').primaryKey(),
  /** Exchange identifier (e.g., 'coinbase', 'binance') */
  name: varchar('name', { length: 50 }).notNull(),
  /** Human-readable exchange name */
  displayName: varchar('display_name', { length: 100 }).notNull(),
  /** WebSocket URL for real-time data */
  wsUrl: varchar('ws_url', { length: 255 }),
  /** REST API base URL */
  restUrl: varchar('rest_url', { length: 255 }),
  /** Array of supported timeframes (e.g., ['1m', '5m', '1h']) */
  supportedTimeframes: jsonb('supported_timeframes').default([]).notNull(),
  /** API rate limits configuration */
  apiLimits: jsonb('api_limits'),
  /** Fee schedule for the exchange */
  feeSchedule: jsonb('fee_schedule'),
  /** Geo restrictions (blocked regions/countries) */
  geoRestrictions: jsonb('geo_restrictions'),
  /** Whether the exchange is active */
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  exchangesNameUnique: unique('exchanges_name_unique').on(table.name),
}));

export type Exchange = typeof exchanges.$inferSelect;
export type NewExchange = typeof exchanges.$inferInsert;
