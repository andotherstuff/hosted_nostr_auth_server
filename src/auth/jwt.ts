// ABOUTME: JWT authentication utilities for stateless auth in Cloudflare Workers
// ABOUTME: Handles token generation, validation, and refresh with proper security

import { SignJWT, jwtVerify, errors } from 'jose';

// JWT configuration
const JWT_ALGORITHM = 'HS256';
const ACCESS_TOKEN_EXPIRY = '15m';  // 15 minutes
const REFRESH_TOKEN_EXPIRY = '7d';  // 7 days

// JWT Claims interface
export interface JWTClaims {
  sub: string;      // User ID
  iat: number;      // Issued at
  exp: number;      // Expires at
  type: 'access' | 'refresh';
  username?: string; // Optional username for convenience
}

// Token pair interface
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// JWT service class
export class JWTService {
  private accessTokenSecret: Uint8Array;
  private refreshTokenSecret: Uint8Array;

  constructor(accessSecret: string, refreshSecret: string) {
    this.accessTokenSecret = new TextEncoder().encode(accessSecret);
    this.refreshTokenSecret = new TextEncoder().encode(refreshSecret);
  }

  /**
   * Generate both access and refresh tokens for a user
   */
  async generateTokenPair(userId: string, username?: string): Promise<TokenPair> {
    const now = Math.floor(Date.now() / 1000);
    
    // Create access token
    const accessToken = await new SignJWT({
      sub: userId,
      type: 'access',
      username,
    })
      .setProtectedHeader({ alg: JWT_ALGORITHM })
      .setIssuedAt(now)
      .setExpirationTime(ACCESS_TOKEN_EXPIRY)
      .setIssuer('chusme-auth-server')
      .setAudience('chusme-clients')
      .sign(this.accessTokenSecret);

    // Create refresh token
    const refreshToken = await new SignJWT({
      sub: userId,
      type: 'refresh',
    })
      .setProtectedHeader({ alg: JWT_ALGORITHM })
      .setIssuedAt(now)
      .setExpirationTime(REFRESH_TOKEN_EXPIRY)
      .setIssuer('chusme-auth-server')
      .setAudience('chusme-clients')
      .sign(this.refreshTokenSecret);

    return { accessToken, refreshToken };
  }

  /**
   * Verify and decode an access token
   */
  async verifyAccessToken(token: string): Promise<JWTClaims> {
    try {
      const { payload } = await jwtVerify(token, this.accessTokenSecret, {
        issuer: 'chusme-auth-server',
        audience: 'chusme-clients',
      });

      // Validate token type and required fields
      if (!payload.sub || !payload.iat || !payload.exp || payload.type !== 'access') {
        throw new Error('Invalid token payload');
      }
      
      return {
        sub: payload.sub as string,
        iat: payload.iat as number,
        exp: payload.exp as number,
        type: payload.type as 'access',
        username: payload.username as string | undefined,
      };
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw new Error('Access token expired');
      }
      if (error instanceof errors.JWTInvalid) {
        throw new Error('Invalid access token');
      }
      throw new Error('Token verification failed');
    }
  }

  /**
   * Verify and decode a refresh token
   */
  async verifyRefreshToken(token: string): Promise<JWTClaims> {
    try {
      const { payload } = await jwtVerify(token, this.refreshTokenSecret, {
        issuer: 'chusme-auth-server',
        audience: 'chusme-clients',
      });

      // Validate token type and required fields
      if (!payload.sub || !payload.iat || !payload.exp || payload.type !== 'refresh') {
        throw new Error('Invalid token payload');
      }
      
      return {
        sub: payload.sub as string,
        iat: payload.iat as number,
        exp: payload.exp as number,
        type: payload.type as 'refresh',
        username: payload.username as string | undefined,
      };
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw new Error('Refresh token expired');
      }
      if (error instanceof errors.JWTInvalid) {
        throw new Error('Invalid refresh token');
      }
      throw new Error('Token verification failed');
    }
  }

  /**
   * Extract Bearer token from Authorization header
   */
  static extractBearerToken(authHeader: string | null): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7); // Remove "Bearer " prefix
  }

  /**
   * Create secure cookie options for refresh tokens
   */
  static getRefreshTokenCookieOptions(): string {
    const maxAge = 7 * 24 * 60 * 60; // 7 days in seconds
    return `HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}; Path=/auth`;
  }
}

// Auth middleware interface
export interface AuthContext {
  userId: string;
  username?: string;
  claims: JWTClaims;
}

// Error types for auth
export class AuthError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number = 401) {
    super(message);
    this.name = 'AuthError';
  }
}

// Common auth errors
export const AuthErrors = {
  NO_TOKEN: new AuthError('No authorization token provided', 'NO_TOKEN', 401),
  INVALID_TOKEN: new AuthError('Invalid or malformed token', 'INVALID_TOKEN', 401),
  EXPIRED_TOKEN: new AuthError('Token has expired', 'EXPIRED_TOKEN', 401),
  WRONG_TOKEN_TYPE: new AuthError('Wrong token type for this endpoint', 'WRONG_TOKEN_TYPE', 401),
  INSUFFICIENT_PERMISSIONS: new AuthError('Insufficient permissions', 'INSUFFICIENT_PERMISSIONS', 403),
};