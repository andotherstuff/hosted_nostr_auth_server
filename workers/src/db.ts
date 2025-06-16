import { drizzle } from 'drizzle-orm/d1';
import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  salt: text('salt').notNull(),
  publicKey: text('public_key'),
  frostShares: text('frost_shares'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const schema = {
  users,
};

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
} 