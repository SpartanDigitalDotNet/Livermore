import { pgTable, serial, varchar, timestamp, boolean, text, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { UserSettings } from '@livermore/schemas';

/**
 * Users table - stores user accounts with OAuth identity fields
 */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  /** Whether the user account is active */
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  // IAM columns (added in Phase 12)
  identityProvider: varchar('identity_provider', { length: 20 }),
  identitySub: varchar('identity_sub', { length: 255 }),
  displayName: varchar('display_name', { length: 100 }),
  identityPictureUrl: text('identity_picture_url'),
  role: varchar('role', { length: 20 }).default('user').notNull(),
  lastLoginAt: timestamp('last_login_at', { mode: 'string' }),
  /** User settings stored as JSONB with version field for schema evolution */
  settings: jsonb('settings').$type<UserSettings>().default({ version: 1 }),
}, (table) => ({
  // Partial unique index for OAuth identity lookup (allows NULL identity_provider)
  identityProviderSubIdx: uniqueIndex('users_identity_provider_sub_idx')
    .on(table.identityProvider, table.identitySub)
    .where(sql`identity_provider IS NOT NULL`),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
