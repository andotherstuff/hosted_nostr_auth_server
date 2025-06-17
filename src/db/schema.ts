import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  salt: text('salt').notNull(),
  publicKey: text('public_key'),
  muSig2Shares: text('musig2_shares'),
  hsmKeyId: text('hsm_key_id'),
  hsmAttestation: text('hsm_attestation'),
  keyCreatedAt: integer('key_created_at'),
  hsmLocation: text('hsm_location'),
  riskScore: real('risk_score').default(0.0),
  lastSecurityReview: integer('last_security_review'),
  securityFlags: text('security_flags'),
  createdAt: integer('created_at').notNull().default(sql`(strftime('%s', 'now'))`)
});

export const userSessions = sqliteTable('user_sessions', {
  sessionId: text('session_id').primaryKey(),
  userId: text('user_id').notNull(),
  accessTokenHash: text('access_token_hash').notNull(),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  deviceFingerprint: text('device_fingerprint').notNull(),
  ipAddress: text('ip_address').notNull(),
  userAgent: text('user_agent'),
  permissions: text('permissions').notNull(),
  mfaVerified: integer('mfa_verified', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at').notNull().default(sql`(strftime('%s', 'now'))`),
  lastActivity: integer('last_activity').notNull().default(sql`(strftime('%s', 'now'))`),
  expiresAt: integer('expires_at').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true)
});

export const sessionActivities = sqliteTable('session_activities', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  activityType: text('activity_type').notNull(),
  ipAddress: text('ip_address'),
  timestamp: integer('timestamp').notNull().default(sql`(strftime('%s', 'now'))`),
  metadata: text('metadata')
});

export const frostShares = sqliteTable('frost_shares', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  participantId: text('participant_id').notNull(),
  signingShare: text('signing_share').notNull(),
  verificationKey: text('verification_key').notNull(),
  threshold: integer('threshold').notNull(),
  createdAt: integer('created_at').notNull().default(sql`(strftime('%s', 'now'))`)
});

export const signingCeremonies = sqliteTable('signing_ceremonies', {
  operationId: text('operation_id').primaryKey(),
  userId: text('user_id').notNull(),
  messageHash: text('message_hash').notNull(),
  threshold: integer('threshold').notNull(),
  participants: text('participants').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull().default(sql`(strftime('%s', 'now'))`),
  completedAt: integer('completed_at')
});

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  timestamp: integer('timestamp').notNull().default(sql`(strftime('%s', 'now'))`),
  userId: text('user_id'),
  sessionId: text('session_id'),
  operation: text('operation').notNull(),
  resource: text('resource'),
  result: text('result').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  deviceFingerprint: text('device_fingerprint'),
  riskScore: real('risk_score'),
  metadata: text('metadata'),
  hsmOperationId: text('hsm_operation_id'),
  frostCeremonyId: text('frost_ceremony_id')
});

export const securityEvents = sqliteTable('security_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull(),
  userId: text('user_id'),
  ipAddress: text('ip_address'),
  description: text('description').notNull(),
  metadata: text('metadata'),
  timestamp: integer('timestamp').notNull().default(sql`(strftime('%s', 'now'))`),
  investigated: integer('investigated', { mode: 'boolean' }).default(false),
  resolved: integer('resolved', { mode: 'boolean' }).default(false)
}); 