// ABOUTME: Input validation and sanitization utilities for security with Zod schemas
// ABOUTME: Prevents injection attacks and validates device information with type safety

import { z } from 'zod';

interface DeviceInfo {
    userAgent: string;
    platform: string;
    language: string;
    screenResolution: string;
    timezone: string;
}

export function validateDeviceInfo(deviceInfo: DeviceInfo): boolean {
    // Validate user agent (reasonable length, no control characters)
    if (!deviceInfo.userAgent || 
        deviceInfo.userAgent.length > 500 || 
        /[\x00-\x1f\x7f]/.test(deviceInfo.userAgent)) {
        return false;
    }

    // Validate platform
    const validPlatforms = [
        'Win32', 'Win64', 'Windows', 'MacIntel', 'MacPPC', 'Mac68K',
        'Linux x86_64', 'Linux i686', 'Linux', 'iPhone', 'iPad', 'iPod',
        'Android', 'unknown'
    ];
    if (!validPlatforms.includes(deviceInfo.platform)) {
        return false;
    }

    // Validate language (should be valid locale format)
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(deviceInfo.language) && deviceInfo.language !== 'unknown') {
        return false;
    }

    // Validate screen resolution (should be NUMBERxNUMBER format)
    if (!/^\d{1,5}x\d{1,5}$/.test(deviceInfo.screenResolution) && deviceInfo.screenResolution !== 'unknown') {
        return false;
    }

    // Validate timezone (should be valid IANA timezone)
    try {
        if (deviceInfo.timezone !== 'UTC' && deviceInfo.timezone !== 'unknown') {
            Intl.DateTimeFormat(undefined, { timeZone: deviceInfo.timezone });
        }
    } catch (error) {
        return false;
    }

    return true;
}

export function sanitizeUserAgent(userAgent: string): string {
    // Remove control characters and limit length
    return userAgent
        .replace(/[\x00-\x1f\x7f]/g, '')
        .substring(0, 500)
        .trim();
}

export function validateUsername(username: string): boolean {
    // Username: 3-50 characters, alphanumeric plus underscore and dash
    return /^[a-zA-Z0-9_-]{3,50}$/.test(username);
}

export function validatePassword(password: string): boolean {
    // Password: at least 8 characters, max 128 for reasonable bcrypt limits
    return password.length >= 8 && password.length <= 128;
}

export function sanitizeInput(input: string, maxLength: number = 255): string {
    return input
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars except \t, \n, \r
        .substring(0, maxLength)
        .trim();
}

export function validateIPAddress(ip: string): boolean {
    // IPv4 regex
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    
    // IPv6 regex (simplified)
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

export function validateSessionId(sessionId: string): boolean {
    // UUIDs should match this pattern
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId);
}

export function validateJSONString(jsonString: string, maxLength: number = 10000): boolean {
    if (jsonString.length > maxLength) {
        return false;
    }
    
    try {
        JSON.parse(jsonString);
        return true;
    } catch {
        return false;
    }
}

export function rateLimitKey(ip: string, operation: string): string {
    return `rate_limit:${operation}:${ip}`;
}

export function sanitizeLogData(data: any): any {
    // Remove or mask sensitive fields from log data
    const sensitive = ['password', 'token', 'secret', 'key', 'hash'];
    
    if (typeof data !== 'object' || data === null) {
        return data;
    }
    
    const sanitized = { ...data };
    
    for (const [key, value] of Object.entries(sanitized)) {
        const lowerKey = key.toLowerCase();
        
        if (sensitive.some(field => lowerKey.includes(field))) {
            sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeLogData(value);
        }
    }
    
    return sanitized;
}

export function createAuditLogEntry(
    operation: string,
    result: 'success' | 'failure' | 'blocked',
    userId?: string,
    sessionId?: string,
    ipAddress?: string,
    metadata?: any
) {
    return {
        id: crypto.randomUUID(),
        timestamp: Math.floor(Date.now() / 1000),
        userId,
        sessionId,
        operation,
        result,
        ipAddress,
        metadata: metadata ? JSON.stringify(sanitizeLogData(metadata)) : null
    };
}

// Zod Schema Definitions for API Validation

export const UsernameSchema = z.string()
  .min(3, 'Username must be at least 3 characters')
  .max(50, 'Username must be at most 50 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscore, and dash');

export const PasswordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const AuthLoginSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
});

export const AuthRegisterSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
});

export const ParticipantIdSchema = z.string()
  .min(1, 'Participant ID cannot be empty')
  .max(100, 'Participant ID too long')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Participant ID can only contain alphanumeric characters, underscore, and dash');

export const OperationIdSchema = z.string()
  .uuid('Operation ID must be a valid UUID');

export const ThresholdSchema = z.number()
  .int('Threshold must be an integer')
  .min(1, 'Threshold must be at least 1')
  .max(20, 'Threshold cannot exceed 20');

export const ParticipantsSchema = z.array(ParticipantIdSchema)
  .min(1, 'At least one participant required')
  .max(20, 'Too many participants')
  .refine(participants => new Set(participants).size === participants.length, {
    message: 'Duplicate participants not allowed'
  });

export const CreateKeygenCeremonySchema = z.object({
  threshold: ThresholdSchema,
  participants: ParticipantsSchema,
}).refine(data => data.threshold <= data.participants.length, {
  message: 'Threshold cannot exceed number of participants',
  path: ['threshold']
});

export const CreateSigningCeremonySchema = z.object({
  message: z.string()
    .min(1, 'Message cannot be empty')
    .max(10000, 'Message too long'),
  participants: ParticipantsSchema,
  threshold: ThresholdSchema,
}).refine(data => data.threshold <= data.participants.length, {
  message: 'Threshold cannot exceed number of participants',
  path: ['threshold']
});

export const RoundDataSchema = z.object({
  participant_data: z.string()
    .min(1, 'Participant data cannot be empty')
    .max(50000, 'Participant data too large')
    .refine(data => {
      try {
        JSON.parse(data);
        return true;
      } catch {
        return false;
      }
    }, 'Participant data must be valid JSON')
});

export const RoundNumberSchema = z.number()
  .int('Round number must be an integer')
  .min(1, 'Round number must be at least 1')
  .max(10, 'Round number too high');

// HTTP Header Validation
export const IPAddressSchema = z.string()
  .refine(ip => validateIPAddress(ip), 'Invalid IP address format');

export const UserAgentSchema = z.string()
  .max(500, 'User agent too long')
  .regex(/^[^\x00-\x1f\x7f]*$/, 'User agent contains invalid characters');

// Request Size Limits
export const REQUEST_SIZE_LIMITS = {
  auth: 1024,          // 1KB for auth requests
  ceremony: 10240,     // 10KB for ceremony requests
  round: 51200,        // 50KB for round data
  default: 1024        // 1KB for other requests
} as const;

// Rate Limiting Configuration
export const RATE_LIMITS = {
  auth_login: { requests: 10, windowMs: 60 * 1000 },      // 10 per minute
  auth_register: { requests: 5, windowMs: 60 * 1000 },    // 5 per minute
  ceremony_start: { requests: 5, windowMs: 60 * 1000 },   // 5 per minute
  ceremony_round: { requests: 30, windowMs: 60 * 1000 },  // 30 per minute
  default: { requests: 100, windowMs: 60 * 1000 }         // 100 per minute
} as const;

// Content Security Policy
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss: https:; frame-ancestors 'none';",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'X-XSS-Protection': '1; mode=block'
} as const;

// CORS Configuration
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400'
} as const;