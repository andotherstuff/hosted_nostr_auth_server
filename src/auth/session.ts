// ABOUTME: Server-side session management for stateless architecture
// ABOUTME: Handles secure session creation, validation, and cleanup

import { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and, lt } from 'drizzle-orm';
import { userSessions, sessionActivities, users } from '../db/schema';
import { createHash, randomBytes } from 'crypto';
import jwt from '@tsndr/cloudflare-worker-jwt';

interface DeviceInfo {
    userAgent: string;
    platform: string;
    language: string;
    screenResolution: string;
    timezone: string;
}

interface SessionData {
    sessionId: string;
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

interface SessionInfo {
    userId: string;
    username: string;
    deviceFingerprint: string;
    permissions: string[];
    mfaVerified: boolean;
    riskScore: number;
}

export class SessionManager {
    private db: DrizzleD1Database;
    private jwtSecret: string;
    private accessTokenExpiry: number = 5 * 60; // 5 minutes
    private refreshTokenExpiry: number = 24 * 60 * 60; // 24 hours
    private maxConcurrentSessions: number = 5;

    constructor(db: DrizzleD1Database, jwtSecret: string) {
        this.db = db;
        this.jwtSecret = jwtSecret;
    }

    async createSession(
        userId: string, 
        username: string,
        deviceInfo: DeviceInfo, 
        ipAddress: string
    ): Promise<SessionData> {
        // Generate session ID and tokens
        const sessionId = this.generateSessionId();
        const accessToken = await this.generateAccessToken(userId, sessionId);
        const refreshToken = this.generateRefreshToken();
        
        // Create device fingerprint
        const deviceFingerprint = this.createDeviceFingerprint(deviceInfo, ipAddress);
        
        // Hash tokens for storage
        const accessTokenHash = this.hashToken(accessToken);
        const refreshTokenHash = this.hashToken(refreshToken);
        
        // Set expiration times
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + this.refreshTokenExpiry;
        
        // Clean up old sessions for this user
        await this.cleanupUserSessions(userId);
        
        // Create session record
        await this.db.insert(userSessions).values({
            sessionId,
            userId,
            accessTokenHash,
            refreshTokenHash,
            deviceFingerprint,
            ipAddress,
            userAgent: deviceInfo.userAgent,
            permissions: JSON.stringify(['sign', 'read_profile']),
            mfaVerified: false,
            createdAt: now,
            lastActivity: now,
            expiresAt,
            isActive: true
        });

        // Log session creation
        await this.logSessionActivity(sessionId, 'session_created', ipAddress, {
            deviceFingerprint,
            userAgent: deviceInfo.userAgent
        });

        return {
            sessionId,
            userId,
            accessToken,
            refreshToken,
            expiresIn: this.accessTokenExpiry
        };
    }

    async validateSession(accessToken: string): Promise<SessionInfo | null> {
        try {
            // Verify JWT
            const isValid = await jwt.verify(accessToken, this.jwtSecret);
            if (!isValid) {
                return null;
            }

            // Decode token to get session info
            const payload = jwt.decode(accessToken);
            const sessionId = payload.payload?.sessionId as string;
            const userId = payload.payload?.userId as string;

            if (!sessionId || !userId) {
                return null;
            }

            // Hash the token to compare with stored hash
            const tokenHash = this.hashToken(accessToken);

            // Look up session in database
            const session = await this.db
                .select({
                    userId: userSessions.userId,
                    deviceFingerprint: userSessions.deviceFingerprint,
                    permissions: userSessions.permissions,
                    mfaVerified: userSessions.mfaVerified,
                    isActive: userSessions.isActive,
                    expiresAt: userSessions.expiresAt,
                    username: users.username
                })
                .from(userSessions)
                .leftJoin(users, eq(userSessions.userId, users.id))
                .where(
                    and(
                        eq(userSessions.sessionId, sessionId),
                        eq(userSessions.accessTokenHash, tokenHash),
                        eq(userSessions.isActive, true)
                    )
                )
                .get();

            if (!session) {
                return null;
            }

            // Check if session is expired
            const now = Math.floor(Date.now() / 1000);
            if (session.expiresAt < now) {
                await this.invalidateSession(sessionId);
                return null;
            }

            // Update last activity
            await this.updateLastActivity(sessionId);

            return {
                userId: session.userId,
                username: session.username || '',
                deviceFingerprint: session.deviceFingerprint,
                permissions: JSON.parse(session.permissions),
                mfaVerified: session.mfaVerified,
                riskScore: 0.0 // TODO: Implement risk scoring
            };
        } catch (error) {
            console.error('Session validation error:', error);
            return null;
        }
    }

    async refreshSession(refreshToken: string, sessionId: string): Promise<SessionData | null> {
        try {
            const refreshTokenHash = this.hashToken(refreshToken);
            
            // Find session with matching refresh token
            const session = await this.db
                .select()
                .from(userSessions)
                .where(
                    and(
                        eq(userSessions.sessionId, sessionId),
                        eq(userSessions.refreshTokenHash, refreshTokenHash),
                        eq(userSessions.isActive, true)
                    )
                )
                .get();

            if (!session) {
                return null;
            }

            // Check if session is expired
            const now = Math.floor(Date.now() / 1000);
            if (session.expiresAt < now) {
                await this.invalidateSession(sessionId);
                return null;
            }

            // Generate new access token
            const newAccessToken = await this.generateAccessToken(session.userId, sessionId);
            const newAccessTokenHash = this.hashToken(newAccessToken);

            // Update session with new access token hash
            await this.db
                .update(userSessions)
                .set({
                    accessTokenHash: newAccessTokenHash,
                    lastActivity: now
                })
                .where(eq(userSessions.sessionId, sessionId));

            // Log refresh activity
            await this.logSessionActivity(sessionId, 'token_refreshed', session.ipAddress);

            return {
                sessionId,
                userId: session.userId,
                accessToken: newAccessToken,
                refreshToken, // Keep same refresh token
                expiresIn: this.accessTokenExpiry
            };
        } catch (error) {
            console.error('Session refresh error:', error);
            return null;
        }
    }

    async invalidateSession(sessionId: string): Promise<void> {
        await this.db
            .update(userSessions)
            .set({ isActive: false })
            .where(eq(userSessions.sessionId, sessionId));

        await this.logSessionActivity(sessionId, 'session_invalidated');
    }

    async invalidateAllUserSessions(userId: string): Promise<void> {
        await this.db
            .update(userSessions)
            .set({ isActive: false })
            .where(eq(userSessions.userId, userId));
    }

    private generateSessionId(): string {
        return crypto.randomUUID();
    }

    private async generateAccessToken(userId: string, sessionId: string): Promise<string> {
        const payload = {
            userId,
            sessionId,
            type: 'access',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + this.accessTokenExpiry
        };

        return await jwt.sign(payload, this.jwtSecret);
    }

    private generateRefreshToken(): string {
        return randomBytes(32).toString('hex');
    }

    private hashToken(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    private createDeviceFingerprint(deviceInfo: DeviceInfo, ipAddress: string): string {
        const fingerprint = [
            deviceInfo.userAgent,
            deviceInfo.platform,
            deviceInfo.screenResolution,
            deviceInfo.timezone,
            ipAddress
        ].join('|');
        
        return createHash('sha256').update(fingerprint).digest('hex');
    }

    private async updateLastActivity(sessionId: string): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        await this.db
            .update(userSessions)
            .set({ lastActivity: now })
            .where(eq(userSessions.sessionId, sessionId));
    }

    private async logSessionActivity(
        sessionId: string, 
        activityType: string, 
        ipAddress?: string, 
        metadata?: any
    ): Promise<void> {
        await this.db.insert(sessionActivities).values({
            id: crypto.randomUUID(),
            sessionId,
            activityType,
            ipAddress,
            timestamp: Math.floor(Date.now() / 1000),
            metadata: metadata ? JSON.stringify(metadata) : null
        });
    }

    private async cleanupUserSessions(userId: string): Promise<void> {
        // Get user's sessions, ordered by creation time (newest first)
        const userSessionList = await this.db
            .select({ sessionId: userSessions.sessionId })
            .from(userSessions)
            .where(
                and(
                    eq(userSessions.userId, userId),
                    eq(userSessions.isActive, true)
                )
            )
            .orderBy(userSessions.createdAt)
            .all();

        // If user has too many sessions, deactivate the oldest ones
        if (userSessionList.length >= this.maxConcurrentSessions) {
            const sessionsToDeactivate = userSessionList.slice(0, userSessionList.length - this.maxConcurrentSessions + 1);
            for (const session of sessionsToDeactivate) {
                await this.invalidateSession(session.sessionId);
            }
        }
    }

    async cleanupExpiredSessions(): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        await this.db
            .update(userSessions)
            .set({ isActive: false })
            .where(lt(userSessions.expiresAt, now));
    }
}