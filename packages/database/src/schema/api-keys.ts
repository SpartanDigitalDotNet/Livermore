import { pgTable, serial, varchar, uuid, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * API Keys table - stores keys for public REST API authentication (Phase 41)
 */
export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  key: uuid('key').notNull().default(sql`gen_random_uuid()`).unique(),
  isActive: boolean('is_active').default(true).notNull(),
  createdBy: varchar('created_by', { length: 255 }).notNull(),
  lastUsedAt: timestamp('last_used_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  keyActiveIdx: index('api_keys_key_active_idx')
    .on(table.key)
    .where(sql`is_active = true`),
}));

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
