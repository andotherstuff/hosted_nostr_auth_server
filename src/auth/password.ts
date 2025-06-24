// ABOUTME: Password hashing and key derivation utilities using PBKDF2 and HKDF
// ABOUTME: Provides secure password verification and separate encryption key derivation

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Password hashing configuration
const PBKDF2_ITERATIONS = 100000; // OWASP recommended minimum
const SALT_LENGTH = 16; // 128 bits
const HASH_LENGTH = 32; // 256 bits

// HKDF contexts for key derivation
const HKDF_CONTEXTS = {
  ENCRYPTION: 'chusme-encryption-key-v1',
  SIGNING: 'chusme-signing-key-v1',
  BACKUP: 'chusme-backup-key-v1',
} as const;

/**
 * Generate a random salt for password hashing
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Hash a password using PBKDF2-SHA256
 */
export async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH * 8 // Convert bytes to bits
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

/**
 * Verify a password against its hash using constant-time comparison
 */
export async function verifyPassword(
  storedHashHex: string,
  saltHex: string,
  passwordAttempt: string
): Promise<boolean> {
  const salt = hexToBytes(saltHex);
  const hashToVerify = await hashPassword(passwordAttempt, salt);
  
  // Constant-time comparison to prevent timing attacks
  return constantTimeEqual(hashToVerify, storedHashHex);
}

/**
 * Derive an encryption key from password hash using HKDF
 * This separates encryption keys from authentication credentials
 */
export async function deriveEncryptionKey(
  passwordHash: string,
  userSalt: Uint8Array,
  context: keyof typeof HKDF_CONTEXTS = 'ENCRYPTION'
): Promise<Uint8Array> {
  const hashBytes = hexToBytes(passwordHash);
  const contextInfo = HKDF_CONTEXTS[context];
  
  // Use HKDF to derive a 32-byte AES-256 key
  const derivedKey = hkdf(sha256, hashBytes, userSalt, contextInfo, 32);
  
  return derivedKey;
}

/**
 * Derive a CryptoKey for AES-GCM encryption from password hash
 */
export async function deriveAESKey(
  passwordHash: string,
  userSalt: Uint8Array,
  context: keyof typeof HKDF_CONTEXTS = 'ENCRYPTION'
): Promise<CryptoKey> {
  const keyBytes = await deriveEncryptionKey(passwordHash, userSalt, context);
  
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false, // Not extractable for security
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-GCM with a derived key
 */
export async function encryptWithDerivedKey(
  data: string,
  passwordHash: string,
  userSalt: Uint8Array,
  context: keyof typeof HKDF_CONTEXTS = 'ENCRYPTION'
): Promise<string> {
  const key = await deriveAESKey(passwordHash, userSalt, context);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
  const encodedData = new TextEncoder().encode(data);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    encodedData
  );

  // Combine IV and ciphertext for storage
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  
  return bytesToHex(combined);
}

/**
 * Decrypt data using AES-GCM with a derived key
 */
export async function decryptWithDerivedKey(
  encryptedDataHex: string,
  passwordHash: string,
  userSalt: Uint8Array,
  context: keyof typeof HKDF_CONTEXTS = 'ENCRYPTION'
): Promise<string> {
  const key = await deriveAESKey(passwordHash, userSalt, context);
  const combined = hexToBytes(encryptedDataHex);
  
  // Extract IV and ciphertext
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decryptedData = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decryptedData);
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Password strength validation
 */
export interface PasswordStrength {
  isValid: boolean;
  score: number; // 0-4
  feedback: string[];
}

export function validatePasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];
  let score = 0;

  // Length check
  if (password.length >= 12) {
    score += 1;
  } else if (password.length >= 8) {
    score += 0.5;
  } else {
    feedback.push('Password should be at least 8 characters long');
  }

  // Character variety checks
  if (/[a-z]/.test(password)) score += 0.5;
  if (/[A-Z]/.test(password)) score += 0.5;
  if (/[0-9]/.test(password)) score += 0.5;
  if (/[^A-Za-z0-9]/.test(password)) score += 0.5;

  // Common patterns check
  if (!/^(.)\1+$/.test(password)) score += 0.5; // Not all same character
  if (!/^(012|123|234|345|456|567|678|789|890|abc|bcd|cde|def)/.test(password.toLowerCase())) {
    score += 0.5; // Not sequential
  }

  // Provide feedback
  if (score < 2) {
    feedback.push('Password is too weak');
  } else if (score < 3) {
    feedback.push('Password could be stronger');
  }

  if (!/[a-z]/.test(password)) feedback.push('Add lowercase letters');
  if (!/[A-Z]/.test(password)) feedback.push('Add uppercase letters');
  if (!/[0-9]/.test(password)) feedback.push('Add numbers');
  if (!/[^A-Za-z0-9]/.test(password)) feedback.push('Add special characters');

  return {
    isValid: score >= 2,
    score: Math.min(4, Math.floor(score)),
    feedback,
  };
}