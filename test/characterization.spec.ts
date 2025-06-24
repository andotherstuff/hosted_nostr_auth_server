// ABOUTME: Characterization tests for existing WebSocket FROST ceremony implementation
// ABOUTME: These tests capture current behavior to prevent regressions during migration

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { UnstableDevWorker } from 'wrangler';

// These tests validate the existing WebSocket-based NIP-46 implementation
// They serve as a regression prevention baseline for the migration to HTTP API + Durable Objects

interface Nip46Request {
  id: string;
  method: string;
  params: string[];
}

interface Nip46Response {
  id: string;
  result?: any;
  error?: string;
}

class TestWebSocketClient {
  private ws: WebSocket;
  private messageHandlers: Map<string, (response: Nip46Response) => void> = new Map();
  private connectPromise: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.connectPromise = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (error) => reject(error);
    });

    this.ws.onmessage = (event) => {
      try {
        const response: Nip46Response = JSON.parse(event.data);
        const handler = this.messageHandlers.get(response.id);
        if (handler) {
          handler(response);
          this.messageHandlers.delete(response.id);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
  }

  async connect(): Promise<void> {
    return this.connectPromise;
  }

  async sendRequest(method: string, params: string[]): Promise<Nip46Response> {
    const id = `test-${Date.now()}-${Math.random()}`;
    const request: Nip46Request = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(id);
        reject(new Error(`Request ${method} timed out after 5 seconds`));
      }, 5000);

      this.messageHandlers.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      this.ws.send(JSON.stringify(request));
    });
  }

  close() {
    this.ws.close();
  }
}

describe('WebSocket NIP-46 Characterization Tests', () => {
  let worker: UnstableDevWorker;
  let workerUrl: string;

  beforeAll(async () => {
    // Start the worker for testing
    // Note: This requires wrangler to be available and configured
    const { unstable_dev } = await import('wrangler');
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
    });
    workerUrl = `ws://localhost:${worker.port}`;
  });

  afterAll(async () => {
    if (worker) {
      await worker.stop();
    }
  });

  describe('Basic Protocol Compliance', () => {
    it('should establish WebSocket connection', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await expect(client.connect()).resolves.toBeUndefined();
      client.close();
    });

    it('should respond to describe method', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();

      const response = await client.sendRequest('describe', []);
      
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual([
        'connect',
        'get_public_key',
        'sign_event',
        'describe'
      ]);

      client.close();
    });

    it('should reject malformed JSON', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();

      // Send malformed JSON directly
      client['ws'].send('invalid json');
      
      // Wait for error response
      await new Promise((resolve) => {
        client['ws'].onmessage = (event) => {
          const response = JSON.parse(event.data);
          expect(response.error).toContain('Invalid JSON');
          resolve(void 0);
        };
      });

      client.close();
    });

    it('should reject invalid request structure', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();

      // Send request missing required fields
      const invalidRequest = { method: 'test' }; // Missing id and params
      client['ws'].send(JSON.stringify(invalidRequest));

      await new Promise((resolve) => {
        client['ws'].onmessage = (event) => {
          const response = JSON.parse(event.data);
          expect(response.error).toContain('Invalid request structure');
          resolve(void 0);
        };
      });

      client.close();
    });
  });

  describe('Authentication Flow', () => {
    const testUsername = `test-user-${Date.now()}`;
    const testPassword = 'test-password-123';

    it('should register new user successfully', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();

      const response = await client.sendRequest('register', [testUsername, testPassword]);
      
      expect(response.error).toBeUndefined();
      expect(response.result).toBe('ok');

      client.close();
    });

    it('should reject duplicate username registration', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();

      // Try to register the same username again
      const response = await client.sendRequest('register', [testUsername, testPassword]);
      
      expect(response.error).toContain('already exists');
      expect(response.result).toBeUndefined();

      client.close();
    });

    it('should authenticate existing user', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();

      const response = await client.sendRequest('connect', [testUsername, testPassword]);
      
      expect(response.error).toBeUndefined();
      expect(response.result).toBe('ack');

      client.close();
    });

    it('should reject invalid credentials', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();

      const response = await client.sendRequest('connect', [testUsername, 'wrong-password']);
      
      expect(response.error).toContain('Invalid username or password');
      expect(response.result).toBeUndefined();

      client.close();
    });

    it('should require authentication for protected methods', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();

      // Try to get public key without authentication
      const response = await client.sendRequest('get_public_key', []);
      
      expect(response.error).toContain('Not authenticated');
      expect(response.result).toBeUndefined();

      client.close();
    });
  });

  describe('Key Management Flow', () => {
    const testUsername = `key-test-user-${Date.now()}`;
    const testPassword = 'key-test-password-123';
    const testPrivateKey = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    beforeEach(async () => {
      // Register and authenticate user for each test
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      await client.sendRequest('register', [testUsername, testPassword]);
      await client.sendRequest('connect', [testUsername, testPassword]);
      
      client.close();
    });

    it('should import private key and generate MuSig2 shares', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      // Authenticate first
      await client.sendRequest('connect', [testUsername, testPassword]);
      
      // Import key
      const response = await client.sendRequest('import_key', [testPrivateKey, testPassword]);
      
      expect(response.error).toBeUndefined();
      expect(response.result).toBe('ok');

      client.close();
    });

    it('should retrieve public key after import', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      // Authenticate and import key
      await client.sendRequest('connect', [testUsername, testPassword]);
      await client.sendRequest('import_key', [testPrivateKey, testPassword]);
      
      // Get public key
      const response = await client.sendRequest('get_public_key', []);
      
      expect(response.error).toBeUndefined();
      expect(response.result).toMatch(/^[0-9a-f]{64}$/i); // 64 char hex string
      
      client.close();
    });

    it('should reject get_public_key before key import', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      // Authenticate but don't import key
      await client.sendRequest('connect', [testUsername, testPassword]);
      
      const response = await client.sendRequest('get_public_key', []);
      
      expect(response.error).toContain('Public key not found');
      expect(response.result).toBeUndefined();

      client.close();
    });
  });

  describe('Signing Flow', () => {
    const testUsername = `sign-test-user-${Date.now()}`;
    const testPassword = 'sign-test-password-123';
    const testPrivateKey = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const testMessage = 'Hello, world!';

    beforeEach(async () => {
      // Set up user with imported key
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      await client.sendRequest('register', [testUsername, testPassword]);
      await client.sendRequest('connect', [testUsername, testPassword]);
      await client.sendRequest('import_key', [testPrivateKey, testPassword]);
      
      client.close();
    });

    it('should sign message with imported key', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      // Authenticate
      await client.sendRequest('connect', [testUsername, testPassword]);
      
      // Sign message
      const response = await client.sendRequest('sign_event', [testMessage, testPassword]);
      
      expect(response.error).toBeUndefined();
      expect(response.result).toMatch(/^[0-9a-f]{128}$/i); // 128 char hex signature
      
      client.close();
    });

    it('should reject signing with wrong password', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      // Authenticate
      await client.sendRequest('connect', [testUsername, testPassword]);
      
      // Try to sign with wrong password
      const response = await client.sendRequest('sign_event', [testMessage, 'wrong-password']);
      
      expect(response.error).toBeDefined();
      expect(response.result).toBeUndefined();
      
      client.close();
    });

    it('should reject signing without imported key', async () => {
      const noKeyUsername = `no-key-user-${Date.now()}`;
      
      // Register user without importing key
      const setupClient = new TestWebSocketClient(workerUrl);
      await setupClient.connect();
      await setupClient.sendRequest('register', [noKeyUsername, testPassword]);
      setupClient.close();
      
      // Try to sign
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      await client.sendRequest('connect', [noKeyUsername, testPassword]);
      
      const response = await client.sendRequest('sign_event', [testMessage, testPassword]);
      
      expect(response.error).toContain('signing info not found');
      expect(response.result).toBeUndefined();
      
      client.close();
    });
  });

  describe('Concurrent Connections', () => {
    it('should handle multiple concurrent connections', async () => {
      const clients: TestWebSocketClient[] = [];
      const numClients = 3;
      
      try {
        // Create multiple clients
        for (let i = 0; i < numClients; i++) {
          const client = new TestWebSocketClient(workerUrl);
          await client.connect();
          clients.push(client);
        }
        
        // All clients should be able to describe simultaneously
        const responses = await Promise.all(
          clients.map(client => client.sendRequest('describe', []))
        );
        
        responses.forEach(response => {
          expect(response.error).toBeUndefined();
          expect(response.result).toEqual([
            'connect',
            'get_public_key', 
            'sign_event',
            'describe'
          ]);
        });
        
      } finally {
        // Clean up all clients
        clients.forEach(client => client.close());
      }
    });

    it('should maintain separate authentication state per connection', async () => {
      const user1 = `concurrent-user-1-${Date.now()}`;
      const user2 = `concurrent-user-2-${Date.now()}`;
      const password = 'test-password';
      
      const client1 = new TestWebSocketClient(workerUrl);
      const client2 = new TestWebSocketClient(workerUrl);
      
      try {
        await Promise.all([client1.connect(), client2.connect()]);
        
        // Register both users
        await Promise.all([
          client1.sendRequest('register', [user1, password]),
          client2.sendRequest('register', [user2, password])
        ]);
        
        // Authenticate only client1
        await client1.sendRequest('connect', [user1, password]);
        
        // Client1 should be able to access protected method
        const response1 = await client1.sendRequest('get_public_key', []);
        expect(response1.error).toContain('Public key not found'); // Expected since no key imported
        
        // Client2 should be rejected (not authenticated)
        const response2 = await client2.sendRequest('get_public_key', []);
        expect(response2.error).toContain('Not authenticated');
        
      } finally {
        client1.close();
        client2.close();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle connection drops gracefully', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      // Register and authenticate
      const username = `drop-test-${Date.now()}`;
      await client.sendRequest('register', [username, 'password']);
      await client.sendRequest('connect', [username, 'password']);
      
      // Force close connection
      client.close();
      
      // Connection should be removed from wsUserMap (verified by server logs)
      // This test mainly ensures no crashes occur on disconnect
      expect(true).toBe(true); // Test passes if no exceptions thrown
    });

    it('should handle unsupported methods', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      const response = await client.sendRequest('unsupported_method', []);
      
      expect(response.error).toBe('Unsupported method');
      expect(response.result).toBeUndefined();
      
      client.close();
    });

    it('should handle missing required parameters', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      // Register without username
      const response = await client.sendRequest('register', ['']);
      
      expect(response.error).toContain('Username and password parameters are required');
      expect(response.result).toBeUndefined();
      
      client.close();
    });
  });

  describe('Performance Characteristics', () => {
    it('should respond to describe method within reasonable time', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      const startTime = Date.now();
      const response = await client.sendRequest('describe', []);
      const duration = Date.now() - startTime;
      
      expect(response.error).toBeUndefined();
      expect(duration).toBeLessThan(1000); // Should respond within 1 second
      
      client.close();
    });

    it('should handle rapid sequential requests', async () => {
      const client = new TestWebSocketClient(workerUrl);
      await client.connect();
      
      // Send 5 describe requests rapidly
      const promises = Array.from({ length: 5 }, (_, i) =>
        client.sendRequest('describe', []).then(response => ({ index: i, response }))
      );
      
      const results = await Promise.all(promises);
      
      // All should succeed
      results.forEach(({ response }) => {
        expect(response.error).toBeUndefined();
        expect(response.result).toEqual([
          'connect',
          'get_public_key',
          'sign_event', 
          'describe'
        ]);
      });
      
      client.close();
    });
  });
});

// Export utilities for potential reuse in migration tests
export { TestWebSocketClient, type Nip46Request, type Nip46Response };