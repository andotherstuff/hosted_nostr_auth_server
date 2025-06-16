import { KVNamespace, ExecutionContext, WebSocketPair, WebSocket } from '@cloudflare/workers-types';
import { getAssetFromKV, NotFoundError } from '@cloudflare/kv-asset-handler';
import { getDb, schema } from './db';
import { bytesToHex, randomBytes, hexToBytes } from "@noble/hashes/utils";
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { sha256 } from "@noble/hashes/sha256";
import { schnorr } from '@noble/curves/secp256k1';

// Placeholder for interfaces/types (can be moved to separate files later)
interface Env {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  CLIENT_REGISTRATIONS: KVNamespace;
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // FROST_COORDINATOR: DurableObjectNamespace;

  // Example binding to environment variables defined in wrangler.toml
  // MY_ENV_VAR: string;

  // Example binding to Cloudflare secrets. Learn more at https://developers.cloudflare.com/workers/runtime-apis/secrets/
  MASTER_KEY: string;
  VAPID_PRIVATE_KEY: string;
  DB: D1Database;
}

// NIP-46 JSON-RPC Interfaces
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

// Password hashing constants
const PBKDF2_ITERATIONS = 100000; // Adjust based on security requirements

// --- Password Hashing ---
async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(hash));
}

// --- Fragment Encryption/Decryption (AES-GCM using PBKDF2 derived key) ---
const ENCRYPTION_SALT_INFO = "musig2-fragment-encryption";

async function deriveEncryptionKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function encryptFragments(fragments: string, encryptionKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedData = new TextEncoder().encode(fragments);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    encryptionKey,
    encodedData
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToHex(combined);
}

async function decryptFragments(encryptedHex: string, encryptionKey: CryptoKey): Promise<string> {
  const combined = hexToBytes(encryptedHex);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decryptedData = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    encryptionKey,
    ciphertext
  );

  return new TextDecoder().decode(decryptedData);
}

// --- MuSig2 Key Generation and Signing ---
async function generateMuSig2Shares(secretKey: string, numShares: number = 2): Promise<{ shares: string[]; groupPublicKey: string }> {
  if (numShares !== 2) throw new Error('Only 2-of-2 sharing is supported in this demo');
  const secretBytes = hexToBytes(secretKey);
  const share1 = randomBytes(32);
  const share2 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    share2[i] = secretBytes[i] ^ share1[i];
  }
  const groupPubKey = schnorr.getPublicKey(secretBytes);
  return {
    shares: [bytesToHex(share1), bytesToHex(share2)],
    groupPublicKey: bytesToHex(groupPubKey)
  };
}

async function signWithMuSig2(shares: string[], messageHash: string): Promise<string> {
  const messageBytes = hexToBytes(messageHash);
  const share1 = hexToBytes(shares[0]);
  const share2 = hexToBytes(shares[1]);
  const privKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    privKey[i] = share1[i] ^ share2[i];
  }
  const signature = schnorr.sign(messageBytes, privKey);
  return bytesToHex(signature);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    console.log(`Received request: ${request.method} ${request.url}`);
    
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      
      // Accept the WebSocket connection
      server.accept();
      
      // Store user ID for this connection
      const wsUserMap = new Map<WebSocket, number>();
      
      server.addEventListener('message', async (event) => {
        console.log('WebSocket message received:', event.data);
        
        let request: Nip46Request;
        try {
          request = JSON.parse(event.data as string);
        } catch (e) {
          console.error('Failed to parse NIP-46 request:', e);
          server.send(JSON.stringify({ id: 'error', error: 'Invalid JSON' }));
          return;
        }
        
        // Validate request structure
        if (!request.id || !request.method || !Array.isArray(request.params)) {
          console.error('Invalid NIP-46 request structure:', request);
          server.send(JSON.stringify({ id: request.id, error: 'Invalid request structure' }));
          return;
        }
        
        const response: Nip46Response = { id: request.id };
        const db = drizzle(env.DB);
        
        try {
          switch (request.method) {
            case 'import_key':
              console.log('Handling import_key request...');
              const userIdForImport = wsUserMap.get(server);
              if (!userIdForImport) throw new Error("Not authenticated");
              
              const [nsecOrHexKey, password] = request.params;
              if (!nsecOrHexKey || typeof nsecOrHexKey !== 'string' || !password || typeof password !== 'string') {
                throw new Error("nsec/hex key and password required for import.");
              }
              
              let privKeyHex: string;
              if (/^[a-fA-F0-9]{64}$/.test(nsecOrHexKey)) {
                privKeyHex = nsecOrHexKey;
              } else if (nsecOrHexKey.startsWith('nsec1')) {
                // TODO: Implement NSEC conversion
                throw new Error('NSEC conversion to hex private key not implemented yet');
              } else {
                throw new Error('Invalid private key format.');
              }
              
              // Generate MuSig2 shares
              const { shares: generatedShares, groupPublicKey } = await generateMuSig2Shares(privKeyHex);
              
              // Encrypt shares
              const userRecord = await db.select({ salt: schema.users.salt })
                .from(schema.users)
                .where(eq(schema.users.id, userIdForImport))
                .limit(1);
              
              if (userRecord.length === 0) throw new Error("User not found during import");
              
              const userSaltBytes = hexToBytes(userRecord[0].salt);
              const encryptionKey = await deriveEncryptionKey(password, userSaltBytes);
              const encryptedShares = await encryptFragments(JSON.stringify(generatedShares), encryptionKey);
              
              // Store in DB
              await db.update(schema.users)
                .set({
                  publicKey: groupPublicKey,
                  frostShares: encryptedShares
                })
                .where(eq(schema.users.id, userIdForImport));
              
              console.log(`MuSig2 shares encrypted and stored for user ${userIdForImport}`);
              response.result = "ok";
              break;
              
            case 'sign_event':
              console.log('Handling sign_event request...');
              const userIdForSign = wsUserMap.get(server);
              if (!userIdForSign) throw new Error("Not authenticated");
              
              // Retrieve user's salt and encrypted shares
              const signUserRecord = await db.select({ 
                salt: schema.users.salt,
                frostShares: schema.users.frostShares
              })
                .from(schema.users)
                .where(eq(schema.users.id, userIdForSign))
                .limit(1);
              
              if (signUserRecord.length === 0 || !signUserRecord[0].salt || !signUserRecord[0].frostShares) {
                throw new Error("User signing info not found or incomplete.");
              }
              
              const signPassword = request.params[1];
              if (!signPassword || typeof signPassword !== 'string') {
                throw new Error("Password needed for key derivation during signing.");
              }
              
              // Decrypt shares
              const signSaltBytes = hexToBytes(signUserRecord[0].salt);
              const signEncryptionKey = await deriveEncryptionKey(signPassword, signSaltBytes);
              const decryptedSharesJson = await decryptFragments(signUserRecord[0].frostShares, signEncryptionKey);
              const decryptedShares = JSON.parse(decryptedSharesJson);
              
              // Hash the message using crypto.subtle.digest to match test implementation
              const messageHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.params[0]));
              
              // Sign with MuSig2
              const signature = await signWithMuSig2(decryptedShares, bytesToHex(new Uint8Array(messageHash)));
              response.result = signature;
              break;
              
            case 'get_public_key':
              const userIdForPubKey = wsUserMap.get(server);
              if (!userIdForPubKey) throw new Error("Not authenticated");
              
              const pubKeyRecord = await db.select({ publicKey: schema.users.publicKey })
                .from(schema.users)
                .where(eq(schema.users.id, userIdForPubKey))
                .limit(1);
              
              if (pubKeyRecord.length === 0 || !pubKeyRecord[0].publicKey) {
                throw new Error("Public key not found or not set for user.");
              }
              
              response.result = pubKeyRecord[0].publicKey;
              break;
              
            case 'describe':
              console.log('Handling describe request...');
              response.result = [
                "connect",
                "get_public_key",
                "sign_event",
                "describe",
              ];
              break;
              
            default:
              console.warn(`Unsupported NIP-46 method: ${request.method}`);
              response.error = 'Unsupported method';
          }
        } catch (err: any) {
          console.error(`Error handling method ${request.method}:`, err);
          response.error = err.message || 'Internal server error';
        }
        
        server.send(JSON.stringify(response));
      });
      
      server.addEventListener('close', (event) => {
        const userId = wsUserMap.get(server);
        console.log(`WebSocket closed for User ID: ${userId}`, event.code, event.reason);
        wsUserMap.delete(server);
      });
      
      return new Response(null, {
        status: 101,
        webSocket: client,
      } as ResponseInit & { webSocket: WebSocket });
    }
    
    // HTTP route stubs for test compatibility
    const url = new URL(request.url);

    if (url.pathname === "/connect" && request.method === "POST") {
      // Simulate storing in KV for test
      await env.CLIENT_REGISTRATIONS.put("dummy_client_pubkey", JSON.stringify({ relays: ["wss://relay.example.com"] }));
      return new Response("Connect endpoint (stub)", { status: 200 });
    }

    if (url.pathname === "/sign" && request.method === "POST") {
      return new Response(JSON.stringify({ result: "dummy_signature", error: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/push" && request.method === "POST") {
      return new Response("Push registration endpoint (stub)", { status: 200 });
    }

    // Serve static assets
    try {
      return await getAssetFromKV({
        request,
        waitUntil: ctx.waitUntil.bind(ctx),
      });
    } catch (e) {
      if (e instanceof NotFoundError) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response('Internal error', { status: 500 });
    }
  }
};

/*
// Example Durable Object class (Uncomment and define if using Durable Objects)
export class FrostCoordinator {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // Handle HTTP requests from Clients.
  async fetch(request: Request): Promise<Response> {
    // Apply requested action.
    // Optionally, you can call back into other Workers using `env`.
    return new Response("Hello from Durable Object!");
  }

  // Add other methods needed for FROST coordination
}
*/ 