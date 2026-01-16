import { pgTable, serial, varchar, jsonb, boolean, timestamp, decimal, bigint, index } from 'drizzle-orm/pg-core';
import { userExchanges } from './user-exchanges';

/**
 * Alert history table - records all triggered alerts
 *
 * Exchange-level (not user-level) because market data is the same for all users
 * on a given exchange. A MACD-V stage change on BTC-USD/Coinbase is a fact,
 * not user-specific.
 */
export const alertHistory = pgTable(
  'alert_history',
  {
    id: serial('id').primaryKey(),
    /** Exchange this alert is for */
    exchangeId: serial('exchange_id')
      .notNull()
      .references(() => userExchanges.id, { onDelete: 'cascade' }),
    /** Trading pair symbol (e.g., BTC-USD) */
    symbol: varchar('symbol', { length: 20 }).notNull(),
    /** Timeframe for indicator alerts (nullable for price alerts) */
    timeframe: varchar('timeframe', { length: 5 }),
    /** Alert type discriminator: macdv_stage, price_cross, volume_spike, etc. */
    alertType: varchar('alert_type', { length: 50 }).notNull(),
    /** UTC epoch milliseconds when triggered */
    triggeredAtEpoch: bigint('triggered_at_epoch', { mode: 'number' }).notNull(),
    /** Human readable timestamp with timezone */
    triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull(),
    /** Price at time of trigger */
    price: decimal('price', { precision: 20, scale: 8 }).notNull(),
    /** The indicator value at trigger (e.g., MACD-V value) */
    triggerValue: decimal('trigger_value', { precision: 20, scale: 8 }),
    /** Current state label (e.g., "rebounding", "crossed $50,000") */
    triggerLabel: varchar('trigger_label', { length: 100 }).notNull(),
    /** Previous state for transitions (e.g., "reversing") */
    previousLabel: varchar('previous_label', { length: 100 }),
    /** Flexible metadata per alert type (all timeframes, bias, etc.) */
    details: jsonb('details'),
    /** Whether notification was sent successfully */
    notificationSent: boolean('notification_sent').default(false).notNull(),
    /** Error message if notification failed */
    notificationError: varchar('notification_error', { length: 500 }),
  },
  (table) => ({
    // Index for querying alerts by exchange and symbol
    exchangeSymbolIdx: index('alert_history_exchange_symbol_idx').on(
      table.exchangeId,
      table.symbol
    ),
    // Index for querying recent alerts
    triggeredAtIdx: index('alert_history_triggered_at_idx').on(table.triggeredAt),
    // Index for filtering by alert type
    alertTypeIdx: index('alert_history_alert_type_idx').on(table.alertType),
  })
);

export type AlertHistoryEntry = typeof alertHistory.$inferSelect;
export type NewAlertHistoryEntry = typeof alertHistory.$inferInsert;
