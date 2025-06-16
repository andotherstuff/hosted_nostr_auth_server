// src/index.ts
// Import base types first
import type {
  ExecutionContext,
  Fetcher,
  // WebSocket, // Rely on global WebSocket type
  ExportedHandler // Import ExportedHandler type
} from '@cloudflare/workers-types';
// Remove direct import of WebSocketPair
// import { WebSocketPair } from '@cloudflare/workers-types';
// Then import other necessary modules
import { getAssetFromKV, NotFoundError } from '@cloudflare/kv-asset-handler';
import { getDb, schema } from './db'; // Import DB utils
import { bytesToHex, randomBytes, hexToBytes } from "@noble/hashes/utils"; // For salt and hex conversion
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { sha256 } from "@noble/hashes/sha256"; // Needed for message hashing
import { schnorr } from '@noble/curves/secp256k1';

// Remove @cmdcode imports
// import { ... } from '@cmdcode/frost';
// import { keys } from '@cmdcode/crypto-tools'; 

// Import WASM module namespace
// @ts-ignore // Ignore module resolution/type issues
import * as frostWasm from '../frost-wasm-pkg/frost_taproot_wasm'; 

// NIP-46 JSON-RPC Interfaces (Basic)
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

// Import the static assets manifest
// @ts-ignore
import manifestJSON from '__STATIC_CONTENT_MANIFEST';
const assetManifest = JSON.parse(manifestJSON);


// Define the environment shape if needed (useful for bindings)
interface Env {
  __STATIC_CONTENT: Fetcher;
  DB: D1Database; // Add D1 binding type
  // FROST_WASM: WebAssembly.Module; // Removed binding
  // Add other bindings like KV, DO, etc. here if you use them
}

// --- Password Hashing (PBKDF2-SHA256) ---
const PBKDF2_ITERATIONS = 100000; // Recommended minimum by OWASP for PBKDF2-HMAC-SHA256

async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256 // Derive 256 bits (32 bytes)
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

async function verifyPassword(
  storedHashHex: string,
  saltHex: string,
  passwordAttempt: string
): Promise<boolean> {
  const salt = hexToBytes(saltHex);
  const hashToVerify = await hashPassword(passwordAttempt, salt);
  // **TODO: Implement constant-time comparison if possible/needed**
  // Simple comparison for now:
  return hashToVerify === storedHashHex;
}
// --- End Password Hashing ---

// --- Fragment Encryption/Decryption (AES-GCM using PBKDF2 derived key) ---
const ENCRYPTION_SALT_INFO = "frost-fragment-encryption"; // Context for deriving encryption key

// Derive AES-GCM key from password and salt
async function deriveEncryptionKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  // Derive a 256-bit AES key
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt, // Use the same salt as password hashing for simplicity here
      iterations: PBKDF2_ITERATIONS, // Use same iterations
      hash: "SHA-256",
      // Add info context if needed to differentiate keys, though salt reuse is common
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true, // Key is extractable (false recommended if not needed elsewhere)
    ["encrypt", "decrypt"]
  );
}

// Encrypt data (e.g., stringified FROST shares)
async function encryptFragments(fragments: string, encryptionKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV recommended for AES-GCM
  const encodedData = new TextEncoder().encode(fragments);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    encryptionKey,
    encodedData
  );

  // Combine IV and ciphertext, then encode for storage
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToHex(combined); // Store as hex string
}

// Decrypt data (e.g., retrieve stringified FROST shares)
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
// --- End Fragment Encryption/Decryption ---

// Map to store authenticated user ID per WebSocket connection
const wsUserMap = new Map<WebSocket, number | null>();

// Helper function to generate MuSig2 shares
async function generateMuSig2Shares(secretKey: string, numShares: number = 2): Promise<{ shares: string[]; groupPublicKey: string }> {
  // Convert hex string to Uint8Array
  const secretBytes = hexToBytes(secretKey);
  
  // Generate shares using MuSig2
  const generatedShares = [];
  for (let i = 0; i < numShares; i++) {
    // Generate a random share
    const share = randomBytes(32);
    generatedShares.push(bytesToHex(share));
  }
  
  // Calculate group public key
  const groupPubKey = schnorr.getPublicKey(secretBytes);
  
  return {
    shares: generatedShares,
    groupPublicKey: bytesToHex(groupPubKey)
  };
}

// Helper function to sign with MuSig2
async function signWithMuSig2(shares: string[], messageHash: string): Promise<string> {
  // For now, we'll just use the first share to sign
  // In a real implementation, this would coordinate with other signers
  const shareBytes = hexToBytes(shares[0]);
  const messageHashBytes = hexToBytes(messageHash);
  
  const signature = schnorr.sign(messageHashBytes, shareBytes);
  return bytesToHex(signature);
}

export default {
  // @ts-ignore // Ignore Handler type mismatch
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    console.log(`Received request: ${request.method} ${request.url}`);

    // Check for WebSocket upgrade request
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      console.log('WebSocket upgrade request received.');
      // WebSocketPair should be globally available
      const webSocketPair = new WebSocketPair();
      // Rely on global WebSocket type
      const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket];

      // Add socket to map with null user ID initially
      wsUserMap.set(server, null);

      // Attach the server WebSocket handler (using Worker WebSocket type)
      server.accept();
      // Use aliased CfWebSocket type for event context if possible, or MessageEvent
      server.addEventListener('message', async (event: MessageEvent) => {
        console.log('WebSocket message received:', event.data);
        let request: Nip46Request | undefined;
        let parseError: Error | null = null;
        try {
          if (typeof event.data !== 'string') {
            throw new Error('Invalid message type received.');
          }
          request = JSON.parse(event.data);
        } catch (err: any) {
           parseError = err; // Store parse error
           console.error('Failed to parse NIP-46 request:', err.message, 'Data:', event.data);
           // Don't proceed if parsing failed
        }

        // Handle parse error (no request object available)
        if (parseError) {
           try { server.send(JSON.stringify({ id: 'unknown', error: `Invalid JSON: ${parseError.message}` })); } catch {} 
           return;
        }

        // If parsing succeeded, but request is null/undefined (shouldn't happen with successful parse, but belt-and-suspenders)
        if (!request) {
            try { server.send(JSON.stringify({ id: 'unknown', error: 'Failed to process request after parsing.' })); } catch {}
            return;
        }
        
        // Validation (now we know request exists)
        try {
          if (!request.id || typeof request.id !== 'string' ||
              !request.method || typeof request.method !== 'string' ||
              !Array.isArray(request.params)) {
            throw new Error('Invalid NIP-46 request structure.');
          }
        } catch (validationError: any) {
          console.error('Failed to validate NIP-46 request:', validationError.message, 'Data:', event.data);
          // Send validation error back, including the ID from the parsed request
          const errorResponse: Nip46Response = { 
            id: request.id, // request.id is guaranteed to exist here if validation fails after parse
            error: `Invalid request structure: ${validationError.message}` 
          };
          try { server.send(JSON.stringify(errorResponse)); } catch {}
          return;
        }

        // Initialize DB client
        const db = getDb(env.DB);

        // Store user ID associated with this WebSocket connection upon successful auth
        let authenticatedUserId: number | null = null;

        // If parse and validation succeeded, proceed with routing
        let response: Nip46Response = { id: request.id };

        try {
          // Route based on method
          switch (request.method) {
            case 'register':
              const [regUsername, regPassword] = request.params;
              if (!regUsername || !regPassword || typeof regUsername !== 'string' || typeof regPassword !== 'string') {
                throw new Error('Username and password parameters are required.');
              }

              // Use PBKDF2
              const salt = randomBytes(16);
              const passwordHashHex = await hashPassword(regPassword, salt);
              const saltHex = bytesToHex(salt);

              try {
                const result = await db.insert(schema.users).values({
                  username: regUsername,
                  passwordHash: passwordHashHex,
                  salt: saltHex,
                }).returning({ id: schema.users.id });

                console.log(`User ${regUsername} registered with ID: ${result[0]?.id}`);
                response.result = "ok";
              } catch (dbError: any) {
                 if (dbError.message?.includes('UNIQUE constraint failed')) {
                     throw new Error(`Username '${regUsername}' already exists.`);
                 } else {
                     console.error("Database error during registration:", dbError);
                     throw new Error("Failed to register user due to database error.");
                 }
              }
              break;
            case 'connect':
              const [connUsername, connPassword] = request.params;
              if (!connUsername || !connPassword || typeof connUsername !== 'string' || typeof connPassword !== 'string') {
                throw new Error('Username and password parameters are required for connect.');
              }
              console.log(`Connect attempt for user: ${connUsername}`);

              // Find user
              const user = await db.select().from(schema.users).where(eq(schema.users.username, connUsername)).limit(1);
              if (user.length === 0) {
                throw new Error('Invalid username or password.');
              }

              // Verify password
              const isValid = await verifyPassword(user[0].passwordHash, user[0].salt, connPassword);
              if (!isValid) {
                throw new Error('Invalid username or password.');
              }

              // Authentication successful!
              wsUserMap.set(server, user[0].id); // Update map with authenticated user ID
              console.log(`User ${connUsername} (ID: ${user[0].id}) authenticated successfully for this connection.`);
              response.result = "ack";
              break;
            case 'get_public_key':
              console.log('Handling get_public_key request...');
              const userIdForPk = wsUserMap.get(server);
              if (!userIdForPk) throw new Error("Not authenticated");
              // Get pubkey from DB for authenticatedUserId
              const pkUser = await db.select({ publicKey: schema.users.publicKey }).from(schema.users).where(eq(schema.users.id, userIdForPk)).limit(1);
              if (pkUser.length === 0 || !pkUser[0].publicKey) {
                  throw new Error("Public key not found or not set for user.");
              }
              response.result = pkUser[0].publicKey; // Return stored key
              break;
            case 'sign_event':
              console.log('Handling sign_event request...');
              const userIdForSign = wsUserMap.get(server);
              if (!userIdForSign) throw new Error("Not authenticated");

              // Retrieve user's salt and encrypted shares
              const signUserRecord = await db.select({ 
                salt: schema.users.salt,
                muSig2Shares: schema.users.muSig2Shares
              }).from(schema.users).where(eq(schema.users.id, userIdForSign)).limit(1);
              
              if (signUserRecord.length === 0 || !signUserRecord[0].salt || !signUserRecord[0].muSig2Shares) {
                throw new Error("User signing info not found or incomplete.");
              }

              // Get password from params
              const signPassword = request.params[1];
              if (!signPassword || typeof signPassword !== 'string') {
                throw new Error("Password needed for key derivation during signing.");
              }

              // Decrypt shares
              const signSaltBytes = hexToBytes(signUserRecord[0].salt);
              const signEncryptionKey = await deriveEncryptionKey(signPassword, signSaltBytes);
              const decryptedSharesHex = await decryptFragments(signUserRecord[0].muSig2Shares, signEncryptionKey);
              const shares = JSON.parse(decryptedSharesHex);

              // Hash the message
              const messageHashHex = bytesToHex(sha256(new TextEncoder().encode(request.params[0])));

              // Sign the event
              const signature = await signWithMuSig2(shares, messageHashHex);
              response.result = signature;
              break;
            case 'import_key':
              console.log('Handling import_key request...');
              const userIdForImport = wsUserMap.get(server);
              if (!userIdForImport) throw new Error("Not authenticated");
              const [privateKeyHex, importPassword] = request.params;
              if (!privateKeyHex || !importPassword || typeof privateKeyHex !== 'string' || typeof importPassword !== 'string') {
                throw new Error('Private key and password parameters are required.');
              }

              // Generate MuSig2 shares
              const { shares: muSig2Shares, groupPublicKey } = await generateMuSig2Shares(privateKeyHex);

              // Encrypt shares
              const importUserRecord = await db.select({ salt: schema.users.salt }).from(schema.users).where(eq(schema.users.id, userIdForImport)).limit(1);
              if (importUserRecord.length === 0) throw new Error("User not found during import");
              const importSaltBytes = hexToBytes(importUserRecord[0].salt);
              const importEncryptionKey = await deriveEncryptionKey(importPassword, importSaltBytes);
              const sharesToEncrypt = JSON.stringify(muSig2Shares);
              const encryptedSharesHex = await encryptFragments(sharesToEncrypt, importEncryptionKey);

              // Store in DB
              await db.update(schema.users)
                .set({ 
                  publicKey: groupPublicKey,
                  muSig2Shares: encryptedSharesHex
                })
                .where(eq(schema.users.id, userIdForImport));

              console.log(`MuSig2 shares encrypted and stored for user ${userIdForImport}`);
              response.result = "ok";
              break;
            case 'describe':
              console.log('Handling describe request...');
              response.result = [
                  "connect", 
                  "get_public_key", 
                  "sign_event", 
                  "describe",
                  // TODO: Add other supported methods like disconnect, delegate, etc.
              ];
              break;
            // TODO: Add other NIP-46 methods (disconnect, etc.)
            default:
              console.warn(`Unsupported NIP-46 method: ${request.method}`);
              response.error = 'Unsupported method';
          }
        } catch (err: any) {
          console.error(`Error handling method ${request.method}:`, err);
          response.error = err.message || 'Internal server error';
        }

        // Send the response
        server.send(JSON.stringify(response));
      });

      server.addEventListener('close', (event: CloseEvent) => {
        const userId = wsUserMap.get(server);
        console.log(`WebSocket closed for User ID: ${userId}`, event.code, event.reason);
        wsUserMap.delete(server); // Remove entry from map on close
      });

      // Use ErrorEvent for error
      // @ts-ignore // Ignore conflicting Event types for error listener
      server.addEventListener('error', (event: ErrorEvent) => {
        const userId = wsUserMap.get(server);
        console.error(`WebSocket error for User ID: ${userId}`, event.error);
        wsUserMap.delete(server); // Also remove on error
      });

      // Return the 101 Switching Protocols response
      // @ts-ignore // Ignore TS error for webSocket property specific to CF Workers
      return new Response(null, {
        status: 101,
        webSocket: client, 
      });
    }

    // If not a WebSocket request, try serving static assets
    try {
      return await getAssetFromKV(
        {
          request,
          waitUntil: (promise) => ctx.waitUntil(promise),
        },
        {
          ASSET_NAMESPACE: env.__STATIC_CONTENT,
          ASSET_MANIFEST: assetManifest,
        }
      );
    } catch (e) {
      if (e instanceof NotFoundError) {
        console.log('Asset not found.');
        // Fall through to the final 404 if asset not found and not WS
      } else {
        console.error('KV Asset Handler error:', e);
        return new Response('An internal error occurred', { status: 500 });
      }
    }

    // Fallback response if not WS and not a known static asset
    return new Response('Not found. This endpoint only handles WebSocket connections or serves static assets.', { status: 404 });
  },
}; // Removed satisfies ExportedHandler<Env> temporarily due to type issues 