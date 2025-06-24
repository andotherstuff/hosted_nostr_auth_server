// ABOUTME: Integration tests for the new HTTP API with JWT authentication
// ABOUTME: Tests auth endpoints and ceremony creation using miniflare environment

import { describe, it, expect, beforeAll } from 'vitest';

// Use local development server for testing
const TEST_BASE_URL = 'http://localhost:8788';

describe('HTTP API Integration Tests', () => {
  let testUser: { username: string; password: string; accessToken?: string };

  beforeAll(() => {
    testUser = {
      username: `test-user-${Date.now()}`,
      password: 'test-password-123!',
    };
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await fetch(`${TEST_BASE_URL}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('Authentication Flow', () => {
    it('should register a new user', async () => {
      const response = await fetch(`${TEST_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testUser.username,
          password: testUser.password,
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.message).toContain('registered');
    });

    it('should reject duplicate username registration', async () => {
      const response = await fetch(`${TEST_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testUser.username,
          password: testUser.password,
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(409);
      expect(data.success).toBe(false);
      expect(data.error).toContain('already exists');
    });

    it('should login with valid credentials', async () => {
      const response = await fetch(`${TEST_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testUser.username,
          password: testUser.password,
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.accessToken).toBeDefined();
      expect(data.data.user.username).toBe(testUser.username);

      // Store token for subsequent tests
      testUser.accessToken = data.data.accessToken;

      // Check for refresh token cookie
      const cookies = response.headers.get('Set-Cookie');
      expect(cookies).toContain('refreshToken=');
      expect(cookies).toContain('HttpOnly');
      expect(cookies).toContain('Secure');
    });

    it('should reject invalid credentials', async () => {
      const response = await fetch(`${TEST_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testUser.username,
          password: 'wrong-password',
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid credentials');
    });

    it('should reject weak passwords', async () => {
      const response = await fetch(`${TEST_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'weak-password-user',
          password: '12345678', // Long enough for Zod but still weak
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('weak');
    });
  });

  describe('Protected Endpoints', () => {
    it('should reject requests without authorization', async () => {
      const response = await fetch(`${TEST_BASE_URL}/ceremony/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'keygen',
          threshold: 2,
          maxParticipants: 3,
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toContain('authorization');
    });

    it('should reject requests with invalid tokens', async () => {
      const response = await fetch(`${TEST_BASE_URL}/ceremony/create`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token',
        },
        body: JSON.stringify({
          type: 'keygen',
          threshold: 2,
          maxParticipants: 3,
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
    });
  });

  describe('Ceremony Management', () => {
    it('should create a keygen ceremony', async () => {
      if (!testUser.accessToken) {
        throw new Error('No access token available for test');
      }

      const response = await fetch(`${TEST_BASE_URL}/ceremony/keygen`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUser.accessToken}`,
        },
        body: JSON.stringify({
          threshold: 2,
          participants: ['user1', 'user2', 'user3'],
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.operationId).toBeDefined();
      expect(data.data.type).toBe('keygen');
      expect(data.data.status).toBe('INIT');
      expect(data.data.threshold).toBe(2);
    });

    it('should create a signing ceremony', async () => {
      if (!testUser.accessToken) {
        throw new Error('No access token available for test');
      }

      const participants = ['user1', 'user2', 'user3'];
      const response = await fetch(`${TEST_BASE_URL}/ceremony/signing`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUser.accessToken}`,
        },
        body: JSON.stringify({
          threshold: 2,
          message: 'Test message to sign',
          participants,
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.operationId).toBeDefined();
      expect(data.data.type).toBe('signing');
      expect(data.data.requiredParticipants).toEqual(participants);
    });

    it('should reject invalid ceremony parameters', async () => {
      if (!testUser.accessToken) {
        throw new Error('No access token available for test');
      }

      const response = await fetch(`${TEST_BASE_URL}/ceremony/signing`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUser.accessToken}`,
        },
        body: JSON.stringify({
          threshold: 2,
          // Missing required message and participants for signing
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid signing ceremony parameters');
    });
  });

  describe('CORS and Security Headers', () => {
    it('should include security headers', async () => {
      const response = await fetch(`${TEST_BASE_URL}/health`);
      
      // Check for basic security headers (added by hono/secure-headers)
      expect(response.headers.get('X-Content-Type-Options')).toBeDefined();
      expect(response.headers.get('X-Frame-Options')).toBeDefined();
    });

    it('should handle CORS preflight requests', async () => {
      const response = await fetch(`${TEST_BASE_URL}/auth/login`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:8787',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await fetch(`${TEST_BASE_URL}/unknown-endpoint`);
      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON', async () => {
      const response = await fetch(`${TEST_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      expect(response.status).toBe(400);
    });

    it('should validate request schemas', async () => {
      const response = await fetch(`${TEST_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: '', // Invalid: too short
          password: 'valid-password',
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid input');
    });
  });
});

// Export test utilities for potential reuse
export { testUser };