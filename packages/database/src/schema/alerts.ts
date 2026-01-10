import { pgTable, serial, varchar, jsonb, boolean, timestamp, decimal, bigint, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { userExchanges } from './user-exchanges';

/**
 * Alerts table - stores user-defined alert configurations
 * User-specific and exchange-specific (alerts are for user's exchange data)
 */
export const alerts = pgTable(
  'alerts',
  {
    id: serial('id').primaryKey(),
    /** User who owns this alert */
    userId: serial('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Exchange connection this alert monitors */
    exchangeId: serial('exchange_id')
      .notNull()
      .references(() => userExchanges.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    timeframe: varchar('timeframe', { length: 5 }).notNull(),
    /** Alert conditions stored as JSON */
    conditions: jsonb('conditions').notNull(),
    /** Whether the alert is currently active */
    isActive: boolean('is_active').default(true).notNull(),
    /** Cooldown period in milliseconds */
    cooldownMs: bigint('cooldown_ms', { mode: 'number' }).default(300000).notNull(),
    /** Last time this alert was triggered */
    lastTriggeredAt: timestamp('last_triggered_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Index for querying user's alerts
    userExchangeIdx: index('alerts_user_exchange_idx').on(
      table.userId,
      table.exchangeId
    ),
    // Index for querying specific symbol alerts
    userSymbolIdx: index('alerts_user_symbol_idx').on(
      table.userId,
      table.exchangeId,
      table.symbol
    ),
  })
);

/**
 * Alert history table - stores alert trigger events
 */
export const alertHistory = pgTable(
  'alert_history',
  {
    id: serial('id').primaryKey(),
    alertId: serial('alert_id')
      .notNull()
      .references(() => alerts.id, { onDelete: 'cascade' }),
    /** Timestamp when alert was triggered */
    triggeredAt: timestamp('triggered_at').defaultNow().notNull(),
    /** Price at the time of trigger */
    price: decimal('price', { precision: 20, scale: 8 }).notNull(),
    /** Snapshot of conditions that were met */
    conditions: jsonb('conditions').notNull(),
    /** Whether Discord notification was sent successfully */
    notificationSent: boolean('notification_sent').default(false).notNull(),
    /** Optional error message if notification failed */
    notificationError: varchar('notification_error', { length: 500 }),
  },
  (table) => ({
    alertIdIdx: index('alert_history_alert_id_idx').on(table.alertId),
    triggeredAtIdx: index('alert_history_triggered_at_idx').on(table.triggeredAt),
  })
);

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type AlertHistoryEntry = typeof alertHistory.$inferSelect;
export type NewAlertHistoryEntry = typeof alertHistory.$inferInsert;
