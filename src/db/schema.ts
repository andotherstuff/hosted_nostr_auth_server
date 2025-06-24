import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  salt: text('salt').notNull(),
  publicKey: text('public_key'),
  frostShares: text('frost_shares'),
  createdAt: integer('created_at').notNull()
});

// Additional tables will be added in future migrations
// For now, keeping just the essential users table for testing 