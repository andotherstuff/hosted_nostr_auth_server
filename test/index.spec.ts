// test/index.spec.ts
import { SELF, env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from 'node:fs'; // To read the migration file
import path from 'node:path';
import { WebSocket } from "ws";
import type { WebSocket as CloudflareWebSocket, WebSocketMessageEvent } from "@cloudflare/workers-types";
import { schnorr } from '@noble/curves/secp256k1';
import { hexToBytes } from '@noble/hashes/utils';

// Helper function to establish a WebSocket connection for testing
async function connectWebSocket(url: string | URL): Promise<CloudflareWebSocket> {
  const httpUrl = url.toString().replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  const resp = await SELF.fetch(httpUrl, {
    headers: { Upgrade: "websocket" },
  });

  const ws = resp.webSocket;
  if (!ws) {
    throw new Error("Server didn't upgrade to WebSocket");
  }

  // Accept the WebSocket connection
  ws.accept();

  // Wait briefly for readyState to become OPEN (instead of listening for 'open' event)
  // Add a timeout to prevent infinite loop in case of failure
  const startTime = Date.now();
  while (ws.readyState !== 1) { // 1 is OPEN in Cloudflare's WebSocket
    if (Date.now() - startTime > 5000) { // 5 second timeout
      throw new Error(`WebSocket failed to open within 5 seconds. Current state: ${ws.readyState}`);
    }
    // Wait a short period before checking again
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Add basic error/close handlers immediately after confirming open
  ws.addEventListener('error', ((event) => {
    console.error("Test WebSocket error:", (event as any).message);
  }) as any);
  
  ws.addEventListener('close', ((event) => {
    console.log("Test WebSocket closed:", (event as any).code, (event as any).reason);
  }) as any);

  return ws;
}

// Helper to send a message and wait for a response
async function sendRpcRequest(ws: CloudflareWebSocket, request: any): Promise<any> {
  return new Promise((resolve) => {
    const messageHandler = ((event) => {
      const response = JSON.parse((event as any).data as string);
      if (response.id === request.id) {
        ws.removeEventListener("message", messageHandler as any);
        resolve(response);
      }
    }) as any;
    
    ws.addEventListener("message", messageHandler as any);
    ws.send(JSON.stringify(request));
  });
}

// Define the migration SQL content directly (simpler than reading file in CF env)
const migrationSql = `
CREATE TABLE \`users\` (\n\t\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t\`username\` text NOT NULL,\n\t\`password_hash\` text NOT NULL,\n\t\`salt\` text NOT NULL,\n\t\`public_key\` text,\n\t\`musig2_shares\` text,\n\t\`created_at\` integer DEFAULT (strftime(\'%s\', \'now\')) NOT NULL\n);\nCREATE UNIQUE INDEX \`users_username_unique\` ON \`users\` (\`username\`);\n`;

// Helper NSEC/Hex Key for testing import
const TEST_HEX_KEY = '11'.repeat(32);
// const TEST_NSEC = keys.hex_to_nsec(TEST_HEX_KEY); // Need keys imported if using this

describe("Worker tests", () => {
  // Apply migrations before any tests run
  beforeAll(async () => {
    console.log("Applying migrations to test D1 database...");
    try {
      // Drizzle expects statements separated, split by semicolon and filter empty
      const statements = migrationSql.split(';').map(s => s.trim()).filter(s => s.length > 0);
      const preparedStatements = statements.map(stmt => env.DB.prepare(stmt));
      await env.DB.batch(preparedStatements);
      console.log("Migrations applied successfully.");
    } catch (err: any) {
       console.error("Failed to apply migrations:", err);
       throw new Error(`Test DB migration failed: ${err.message}`);
    }
  });

  it("should return static index.html for root", async () => {
    const response = await SELF.fetch("http://example.com/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toContain("<title>Chusme Auth - Nostr Key Vault & Signer</title>"); // Check for title from public/dist/index.html
  });

  it("should return 404 for unknown non-WebSocket path", async () => {
    const response = await SELF.fetch("http://example.com/unknown-path");
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).toContain("Not found. This endpoint only handles WebSocket connections or serves static assets.");
  });

  // WebSocket tests
  describe("WebSocket Handling", () => {
    let ws: CloudflareWebSocket;
    const TEST_HEX_KEY = "0000000000000000000000000000000000000000000000000000000000000001"; // Test private key

    beforeAll(async () => {
      ws = await connectWebSocket("ws://example.com/");
      ws.addEventListener("error", ((event) => {
        console.error("WebSocket error:", (event as any).message);
      }) as any);
    });

    afterAll(() => {
      // Close the WebSocket after tests
      if (ws && ws.readyState === 1) { // 1 is OPEN in Cloudflare's WebSocket
        ws.close(1000, "Test finished");
      }
    });

    it("should handle valid connect request (with auth)", async () => {
      // Register user first
      const username = `testuser_connect_${Date.now()}`;
      const password = "p1";
      const regRes = await sendRpcRequest(ws, { id: "c_reg", method: "register", params: [username, password] });
      expect(regRes.result).toBe("ok");

      // Now connect
      const req = { id: "test1", method: "connect", params: [username, password] };
      const res = await sendRpcRequest(ws, req);
      expect(res).toEqual({ id: "test1", result: "ack" });
    });

    it("should handle unsupported method request", async () => {
      const req = { id: "test4", method: "unknown_method", params: [] };
      const res = await sendRpcRequest(ws, req);
      expect(res).toEqual({ id: "test4", error: "Unsupported method" });
    });

    it("should handle describe request", async () => {
      const req = { id: "test5", method: "describe", params: [] };
      const res = await sendRpcRequest(ws, req);
      expect(res.id).toBe("test5");
      expect(res.error).toBeUndefined();
      expect(res.result).toEqual(expect.arrayContaining([
        "connect",
        "get_public_key",
        "sign_event",
        "describe"
      ]));
    });

    it("should reject invalid JSON", async () => {
      const invalidJson = "{ not json";
      const errorPromise = new Promise((resolve, reject) => {
        const listener = ((event) => {
          try {
            const data = JSON.parse((event as any).data);
            if (data.id === 'unknown' && data.error && data.error.includes("Invalid JSON")) {
              ws.removeEventListener("message", listener as any);
              resolve(data);
            } else {
              reject(`Unexpected message received: ${(event as any).data}`);
            }
          } catch (e) {
            reject(`Failed to parse error response: ${(event as any).data}`);
          }
        }) as any;
        
        ws.addEventListener("message", listener as any);
        setTimeout(() => {
          ws.removeEventListener("message", listener as any);
          reject("Timeout waiting for error response to invalid JSON");
        }, 500);
      });
      
      ws.send(invalidJson);
      await expect(errorPromise).resolves.toHaveProperty("error");
    });

    it("should reject request missing method", async () => {
      const req = { id: "test6", params: [] }; // Missing method
      const res = await sendRpcRequest(ws, req);
      // Expect specific error message and the original ID
      expect(res.error).toContain("Invalid request structure"); 
      expect(res.id).toBe("test6"); 
    });

    it("should reject request with non-string method", async () => {
      const req = { id: "test7", method: 123, params: [] }; // Non-string method
      const res = await sendRpcRequest(ws, req);
      expect(res.error).toContain("Invalid request structure");
      expect(res.id).toBe("test7");
    });

    it("should reject request with non-array params", async () => {
      const req = { id: "test8", method: "connect", params: "not-an-array" }; 
      const res = await sendRpcRequest(ws, req);
      expect(res.error).toContain("Invalid request structure");
      expect(res.id).toBe("test8");
    });

    // Add a describe block specifically for auth tests
    describe("Authentication", () => {
      it("should register a new user", async () => {
          const username = `testuser_${Date.now()}`; // Ensure unique username
          const password = "password123";
          const req = { id: "reg1", method: "register", params: [username, password] };
          const res = await sendRpcRequest(ws, req);

          expect(res.id).toBe("reg1");
          expect(res.error).toBeUndefined();
          expect(res.result).toBe("ok");

          // Optional: Verify user exists in the local DB
          // Note: Accessing DB directly in tests requires setup
          // We might need to expose a helper or query via wrangler/miniflare
          // For now, we trust the "ok" response.
          // Example (pseudo-code):
          // const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
          // expect(user).toBeDefined();
          // expect(user?.username).toBe(username);
      });

      it("should reject registration with existing username", async () => {
          const username = `testuser_${Date.now()}`;
          const password = "password123";
          const req1 = { id: "reg2a", method: "register", params: [username, password] };
          const req2 = { id: "reg2b", method: "register", params: [username, "anotherpassword"] };

          // First registration should succeed
          const res1 = await sendRpcRequest(ws, req1);
          expect(res1.result).toBe("ok");

          // Second registration with same username should fail
          const res2 = await sendRpcRequest(ws, req2);
          expect(res2.id).toBe("reg2b");
          expect(res2.result).toBeUndefined();
          expect(res2.error).toContain(`Username '${username}' already exists.`);
      });

      it("should reject registration with missing params", async () => {
          const req = { id: "reg3", method: "register", params: ["just_username"] }; // Missing password
          const res = await sendRpcRequest(ws, req);
          expect(res.id).toBe("reg3");
          expect(res.result).toBeUndefined();
          expect(res.error).toContain("Username and password parameters are required.");
      });

      // --- Connect/Login Tests ---
      it("should connect (authenticate) with correct credentials", async () => {
          const username = `testuser_${Date.now()}`;
          const password = "password123";
          
          // Register first
          const regReq = { id: "reg_connect", method: "register", params: [username, password] };
          const regRes = await sendRpcRequest(ws, regReq);
          expect(regRes.result).toBe("ok");

          // Now try to connect
          const req = { id: "test_connect", method: "connect", params: [username, password] };
          const res = await sendRpcRequest(ws, req);
          expect(res).toEqual({ id: "test_connect", result: "ack" });
      });

      it("should reject connect with incorrect password", async () => {
         const username = `testuser_${Date.now()}`;
         const password = "password123";
         await sendRpcRequest(ws, { id: "conn2a", method: "register", params: [username, password] }); 

         const req = { id: "conn2b", method: "connect", params: [username, "wrongpassword"] };
         const res = await sendRpcRequest(ws, req);
         expect(res.id).toBe("conn2b");
         expect(res.result).toBeUndefined();
         expect(res.error).toContain("Invalid username or password");
      });

      it("should reject connect for non-existent user", async () => {
          const req = { id: "conn3", method: "connect", params: ["nosuchuser", "password123"] };
          const res = await sendRpcRequest(ws, req);
          expect(res.id).toBe("conn3");
          expect(res.result).toBeUndefined();
          expect(res.error).toContain("Invalid username or password");
      });
      
      it("should reject connect with missing params", async () => {
          const req = { id: "conn4", method: "connect", params: ["username_only"] };
          const res = await sendRpcRequest(ws, req);
          expect(res.id).toBe("conn4");
          expect(res.result).toBeUndefined();
          expect(res.error).toContain("Username and password parameters are required");
      });

      // TODO: Add tests for calling get_public_key/sign_event before/after successful connect

    });

    // -- Key Setup & Usage Tests --
    describe("MuSig2 Setup and Use", () => {
      let testUsername: string;
      let testPassword = "p4ssw0rd_Setup";
      let importRequestId = "import1";

      // Register and connect user before these tests
      beforeAll(async () => {
        testUsername = `testuser_setup_${Date.now()}`;
        await sendRpcRequest(ws, { id: "reg_setup", method: "register", params: [testUsername, testPassword] });
        const connRes = await sendRpcRequest(ws, { id: "conn_setup1", method: "connect", params: [testUsername, testPassword] });
        expect(connRes.result).toBe("ack"); // Ensure connection works
      });

      it("should import key and setup MuSig2 shares successfully", async () => {
        // Use import_key method
        const req = { id: importRequestId, method: "import_key", params: [TEST_HEX_KEY, testPassword] }; 
        const res = await sendRpcRequest(ws, req);
        expect(res.id).toBe(importRequestId);
        expect(res.error).toBeUndefined();
        expect(res.result).toBe("ok");
      });

      it("should get correct public key after import", async () => {
        // Perform import WITHIN this test
        const importReq = { id: "import_for_getpk", method: "import_key", params: [TEST_HEX_KEY, testPassword] }; 
        const importRes = await sendRpcRequest(ws, importReq);
        expect(importRes.result, "Import failed before get_public_key").toBe("ok");

        // Now test get_public_key
        const req = { id: "getpk_after_import", method: "get_public_key", params: [] };
        const res = await sendRpcRequest(ws, req);
        expect(res.id).toBe("getpk_after_import");
        expect(res.error).toBeUndefined();
        // Expect a valid hex public key (64 chars for Schnorr)
        expect(res.result).toMatch(/^[a-fA-F0-9]{64}$/);
      });

      it("should perform sign_event after import", async () => {
        // Perform import WITHIN this test
        const importReq = { id: "import_for_sign", method: "import_key", params: [TEST_HEX_KEY, testPassword] }; 
        const importRes = await sendRpcRequest(ws, importReq);
        expect(importRes.result, "Import failed before sign_event").toBe("ok");

        // Now test sign_event
        const eventData = JSON.stringify({ content: "test signature" });
        const req = { id: "sign_after_import", method: "sign_event", params: [eventData, testPassword] }; 
        const res = await sendRpcRequest(ws, req);
        expect(res.id).toBe("sign_after_import");
        expect(res.error).toBeUndefined();
        // Expect a valid hex signature (128 chars for Schnorr)
        expect(res.result).toMatch(/^[a-fA-F0-9]{128}$/);

        // Now verify the signature using schnorr.verify
        // Get the public key
        const getPkReq = { id: "getpk_after_sign", method: "get_public_key", params: [] };
        const pkRes = await sendRpcRequest(ws, getPkReq);
        expect(pkRes.error).toBeUndefined();
        expect(pkRes.result).toMatch(/^[a-fA-F0-9]{64}$/);
        const pubkey = pkRes.result;

        // Hash the event data as in the worker
        const messageHash = await (async () => {
          const encoder = new TextEncoder();
          const bytes = encoder.encode(eventData);
          return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        })();

        // schnorr.verify expects (sig, msg, pubkey)
        const isValid = schnorr.verify(res.result, messageHash, pubkey);
        expect(isValid).toBe(true);
      });
      
      it("should fail get_public_key if import not run", async () => {
        // Register and connect a NEW user who hasn't run import
        const newUser = `new_import_${Date.now()}`;
        const newPass = "newpass";
        await sendRpcRequest(ws, { id: "reg_nosetup", method: "register", params: [newUser, newPass] });
        const connRes = await sendRpcRequest(ws, { id: "conn_nosetup", method: "connect", params: [newUser, newPass] });
        expect(connRes.result).toBe("ack");
        
        const req = { id: "getpk_no_import", method: "get_public_key", params: [] };
        const res = await sendRpcRequest(ws, req);
        expect(res.id).toBe("getpk_no_import");
        expect(res.result).toBeUndefined();
        expect(res.error).toContain("Public key not found or not set");
      });
    });
  });
}); 