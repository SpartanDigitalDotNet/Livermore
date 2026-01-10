import { pgTable, serial, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';

/**
 * User settings table - stores application configuration and preferences
 * Key-value store for flexible settings storage
 */
export const userSettings = pgTable('user_settings', {
  id: serial('id').primaryKey(),
  /** Setting key (e.g., 'chart_layout', 'favorite_symbols', 'default_timeframe') */
  key: varchar('key', { length: 100 }).notNull().unique(),
  /** Setting value stored as JSON for flexibility */
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type UserSetting = typeof userSettings.$inferSelect;
export type NewUserSetting = typeof userSettings.$inferInsert;
