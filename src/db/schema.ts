import { sqliteTable, text, integer, sql } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  salt: text('salt').notNull(), // Store the salt used for hashing
  publicKey: text('public_key'), // To store the associated Nostr public key (npub/hex)
  muSig2Shares: text('musig2_shares'), // Store MuSig2 shares (JSON stringified)
  createdAt: integer('created_at').notNull().default(sql`(strftime('%s', 'now'))`)
});

// We need sql from drizzle-orm for the default timestamp
import { sql } from 'drizzle-orm'; 