// ABOUTME: Session management for stateless client - handles authentication tokens securely
// ABOUTME: No browser storage, uses secure HTTP-only cookies for refresh tokens

interface LoginResponse {
    accessToken: string;
    sessionId: string;
    expiresIn: number;
}

interface DeviceInfo {
    userAgent: string;
    platform: string;
    language: string;
    screenResolution: string;
    timezone: string;
}

export class SessionManager {
    private accessToken: string | null = null;
    private tokenExpiry: number = 0;

    async login(username: string, password: string, deviceInfo?: any): Promise<boolean> {
        try {
            const device = deviceInfo || this.collectDeviceInfo();
            
            const response = await fetch('/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include', // Include cookies for refresh token
                body: JSON.stringify({
                    username,
                    password,
                    deviceInfo: device
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Login failed');
            }

            const data: LoginResponse = await response.json();
            
            // Store access token in memory only
            this.accessToken = data.accessToken;
            this.tokenExpiry = Date.now() + (data.expiresIn * 1000);

            return true;
        } catch (error) {
            console.error('Session login error:', error);
            throw error;
        }
    }

    async logout(): Promise<void> {
        try {
            if (this.accessToken) {
                await fetch('/auth/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                    },
                    credentials: 'include'
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Always clear local state
            this.accessToken = null;
            this.tokenExpiry = 0;
        }
    }

    async isAuthenticated(): Promise<boolean> {
        if (!this.accessToken) {
            // Try to refresh session using HTTP-only cookie
            return await this.refreshSession();
        }

        // Check if token is still valid
        if (Date.now() >= this.tokenExpiry - 30000) { // Refresh 30s early
            return await this.refreshSession();
        }

        return true;
    }

    async getAccessToken(): Promise<string | null> {
        if (await this.isAuthenticated()) {
            return this.accessToken;
        }
        return null;
    }

    private async refreshSession(): Promise<boolean> {
        try {
            const response = await fetch('/auth/refresh', {
                method: 'POST',
                credentials: 'include', // Use HTTP-only refresh token cookie
            });

            if (!response.ok) {
                // Session expired or invalid
                this.accessToken = null;
                this.tokenExpiry = 0;
                return false;
            }

            const data: LoginResponse = await response.json();
            
            this.accessToken = data.accessToken;
            this.tokenExpiry = Date.now() + (data.expiresIn * 1000);

            return true;
        } catch (error) {
            console.error('Session refresh error:', error);
            this.accessToken = null;
            this.tokenExpiry = 0;
            return false;
        }
    }

    private collectDeviceInfo(): DeviceInfo {
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screenResolution: `${screen.width}x${screen.height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
    }

    // Create authenticated request headers
    async createAuthHeaders(): Promise<Record<string, string>> {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
    }

    // Make authenticated requests with automatic token refresh
    async authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
        const headers = await this.createAuthHeaders();
        
        const response = await fetch(url, {
            ...options,
            headers: {
                ...headers,
                ...(options.headers || {})
            },
            credentials: 'include'
        });

        // If unauthorized, try to refresh token once
        if (response.status === 401 && await this.refreshSession()) {
            const newHeaders = await this.createAuthHeaders();
            return fetch(url, {
                ...options,
                headers: {
                    ...newHeaders,
                    ...(options.headers || {})
                },
                credentials: 'include'
            });
        }

        return response;
    }
}