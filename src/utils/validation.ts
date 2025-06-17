// ABOUTME: Input validation and sanitization utilities for security
// ABOUTME: Prevents injection attacks and validates device information

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