// ABOUTME: Authentication routes for stateless session-based auth
// ABOUTME: Handles login, logout, refresh, and session management endpoints

import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { SessionManager } from './session';
import { verifyPassword } from '../utils/crypto';
import { validateDeviceInfo, sanitizeUserAgent } from '../utils/validation';

interface Env {
    DB: D1Database;
    JWT_SECRET: string;
}

interface LoginRequest {
    username: string;
    password: string;
    deviceInfo?: {
        userAgent: string;
        platform: string;
        language: string;
        screenResolution: string;
        timezone: string;
    };
}

export function createAuthRoutes(db: DrizzleD1Database, jwtSecret: string) {
    const auth = new Hono<{ Bindings: Env }>();
    const sessionManager = new SessionManager(db, jwtSecret);

    // Login endpoint
    auth.post('/login', async (c) => {
        try {
            const body = await c.req.json() as LoginRequest;
            const { username, password, deviceInfo } = body;

            // Validate input
            if (!username || !password) {
                return c.json({ error: 'Username and password required' }, 400);
            }

            // Get client IP
            const ipAddress = c.req.header('CF-Connecting-IP') || 
                             c.req.header('X-Forwarded-For') || 
                             '0.0.0.0';

            // Get user agent
            const userAgent = sanitizeUserAgent(c.req.header('User-Agent') || '');

            // Find user
            const user = await db
                .select()
                .from(users)
                .where(eq(users.username, username))
                .get();

            if (!user) {
                // Log failed login attempt
                console.log(`Failed login attempt for username: ${username} from IP: ${ipAddress}`);
                return c.json({ error: 'Invalid credentials' }, 401);
            }

            // Verify password
            const isValidPassword = await verifyPassword(password, user.passwordHash, user.salt);
            if (!isValidPassword) {
                console.log(`Failed password verification for user: ${username} from IP: ${ipAddress}`);
                return c.json({ error: 'Invalid credentials' }, 401);
            }

            // Prepare device info
            const processedDeviceInfo = {
                userAgent,
                platform: deviceInfo?.platform || 'unknown',
                language: deviceInfo?.language || 'en',
                screenResolution: deviceInfo?.screenResolution || 'unknown',
                timezone: deviceInfo?.timezone || 'UTC'
            };

            // Validate device info
            if (!validateDeviceInfo(processedDeviceInfo)) {
                return c.json({ error: 'Invalid device information' }, 400);
            }

            // Create session
            const sessionData = await sessionManager.createSession(
                user.id,
                user.username,
                processedDeviceInfo,
                ipAddress
            );

            // Set HTTP-only refresh token cookie
            setCookie(c, 'refresh_token', sessionData.refreshToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'Strict',
                maxAge: 24 * 60 * 60, // 24 hours
                path: '/auth'
            });

            // Set session ID cookie
            setCookie(c, 'session_id', sessionData.sessionId, {
                httpOnly: true,
                secure: true,
                sameSite: 'Strict',
                maxAge: 24 * 60 * 60,
                path: '/'
            });

            console.log(`Successful login for user: ${username} from IP: ${ipAddress}`);

            return c.json({
                accessToken: sessionData.accessToken,
                sessionId: sessionData.sessionId,
                expiresIn: sessionData.expiresIn
            });

        } catch (error) {
            console.error('Login error:', error);
            return c.json({ error: 'Internal server error' }, 500);
        }
    });

    // Refresh token endpoint
    auth.post('/refresh', async (c) => {
        try {
            const refreshToken = getCookie(c, 'refresh_token');
            const sessionId = getCookie(c, 'session_id');

            if (!refreshToken || !sessionId) {
                return c.json({ error: 'No refresh token provided' }, 401);
            }

            const sessionData = await sessionManager.refreshSession(refreshToken, sessionId);
            if (!sessionData) {
                // Clear invalid cookies
                deleteCookie(c, 'refresh_token', { path: '/auth' });
                deleteCookie(c, 'session_id', { path: '/' });
                return c.json({ error: 'Invalid or expired refresh token' }, 401);
            }

            return c.json({
                accessToken: sessionData.accessToken,
                expiresIn: sessionData.expiresIn
            });

        } catch (error) {
            console.error('Refresh error:', error);
            return c.json({ error: 'Internal server error' }, 500);
        }
    });

    // Logout endpoint
    auth.post('/logout', async (c) => {
        try {
            const sessionId = getCookie(c, 'session_id');
            
            if (sessionId) {
                await sessionManager.invalidateSession(sessionId);
            }

            // Clear cookies
            deleteCookie(c, 'refresh_token', { path: '/auth' });
            deleteCookie(c, 'session_id', { path: '/' });

            return c.json({ success: true });

        } catch (error) {
            console.error('Logout error:', error);
            return c.json({ error: 'Internal server error' }, 500);
        }
    });

    // Session validation middleware for other routes
    auth.use('/validate', async (c, next) => {
        const authHeader = c.req.header('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return c.json({ error: 'No authorization token provided' }, 401);
        }

        const token = authHeader.substring(7);
        const sessionInfo = await sessionManager.validateSession(token);
        
        if (!sessionInfo) {
            return c.json({ error: 'Invalid or expired token' }, 401);
        }

        // Store session info in context for use by other handlers
        c.set('sessionInfo', sessionInfo);
        await next();
    });

    // Get current session info
    auth.get('/session', async (c) => {
        const authHeader = c.req.header('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return c.json({ error: 'No authorization token provided' }, 401);
        }

        const token = authHeader.substring(7);
        const sessionInfo = await sessionManager.validateSession(token);
        
        if (!sessionInfo) {
            return c.json({ error: 'Invalid or expired token' }, 401);
        }

        return c.json({
            userId: sessionInfo.userId,
            username: sessionInfo.username,
            permissions: sessionInfo.permissions,
            mfaVerified: sessionInfo.mfaVerified,
            riskScore: sessionInfo.riskScore
        });
    });

    // Invalidate all sessions for current user
    auth.post('/logout-all', async (c) => {
        try {
            const authHeader = c.req.header('Authorization');
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return c.json({ error: 'No authorization token provided' }, 401);
            }

            const token = authHeader.substring(7);
            const sessionInfo = await sessionManager.validateSession(token);
            
            if (!sessionInfo) {
                return c.json({ error: 'Invalid or expired token' }, 401);
            }

            await sessionManager.invalidateAllUserSessions(sessionInfo.userId);

            // Clear cookies
            deleteCookie(c, 'refresh_token', { path: '/auth' });
            deleteCookie(c, 'session_id', { path: '/' });

            return c.json({ success: true });

        } catch (error) {
            console.error('Logout all error:', error);
            return c.json({ error: 'Internal server error' }, 500);
        }
    });

    return auth;
}