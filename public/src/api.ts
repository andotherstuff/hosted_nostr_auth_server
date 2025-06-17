// ABOUTME: API client for NostrPassportServer - handles all server communication
// ABOUTME: Uses stateless session-based authentication, no client-side crypto operations

import { SessionManager } from './session';

interface UserInfo {
    username: string;
    publicKey: string;
    created: number;
}

interface SignEventRequest {
    eventData: any;
    signingMethod: 'hsm' | 'frost';
}

interface SignMessageRequest {
    message: string;
    format: 'raw' | 'nostr';
}

interface SignResponse {
    signature: string;
    publicKey: string;
}

export class NostrAPI {
    private sessionManager: SessionManager;

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    async getUserInfo(): Promise<UserInfo> {
        try {
            const response = await this.sessionManager.authenticatedFetch('/api/user/info');
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to get user info');
            }

            return await response.json();
        } catch (error) {
            console.error('Get user info error:', error);
            throw error;
        }
    }

    async signEvent(eventData: any, signingMethod: 'hsm' | 'frost' = 'hsm'): Promise<string> {
        try {
            const request: SignEventRequest = {
                eventData,
                signingMethod
            };

            const response = await this.sessionManager.authenticatedFetch('/api/sign/event', {
                method: 'POST',
                body: JSON.stringify(request)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Signing failed');
            }

            const result: SignResponse = await response.json();
            return result.signature;
        } catch (error) {
            console.error('Sign event error:', error);
            throw error;
        }
    }

    async signMessage(message: string, format: 'raw' | 'nostr' = 'raw'): Promise<string> {
        try {
            const request: SignMessageRequest = {
                message,
                format
            };

            const response = await this.sessionManager.authenticatedFetch('/api/sign/message', {
                method: 'POST',
                body: JSON.stringify(request)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Message signing failed');
            }

            const result: SignResponse = await response.json();
            return result.signature;
        } catch (error) {
            console.error('Sign message error:', error);
            throw error;
        }
    }

    async startFrostCeremony(threshold: number, participants: string[]): Promise<string> {
        try {
            const response = await this.sessionManager.authenticatedFetch('/api/frost/ceremony/start', {
                method: 'POST',
                body: JSON.stringify({
                    threshold,
                    participants
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to start FROST ceremony');
            }

            const result = await response.json();
            return result.operationId;
        } catch (error) {
            console.error('Start FROST ceremony error:', error);
            throw error;
        }
    }

    async submitFrostRound(operationId: string, roundNumber: number, participantData: any): Promise<any> {
        try {
            const response = await this.sessionManager.authenticatedFetch(
                `/api/frost/ceremony/${operationId}/round/${roundNumber}`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        participantData
                    })
                }
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to submit FROST round data');
            }

            return await response.json();
        } catch (error) {
            console.error('Submit FROST round error:', error);
            throw error;
        }
    }

    async getFrostCeremonyStatus(operationId: string): Promise<any> {
        try {
            const response = await this.sessionManager.authenticatedFetch(
                `/api/frost/ceremony/${operationId}/status`
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to get ceremony status');
            }

            return await response.json();
        } catch (error) {
            console.error('Get FROST ceremony status error:', error);
            throw error;
        }
    }

    async getPublicKey(): Promise<string> {
        try {
            const response = await this.sessionManager.authenticatedFetch('/api/user/pubkey');
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to get public key');
            }

            const result = await response.json();
            return result.publicKey;
        } catch (error) {
            console.error('Get public key error:', error);
            throw error;
        }
    }

    async getSigningMethods(): Promise<string[]> {
        try {
            const response = await this.sessionManager.authenticatedFetch('/api/user/signing-methods');
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to get signing methods');
            }

            const result = await response.json();
            return result.methods;
        } catch (error) {
            console.error('Get signing methods error:', error);
            throw error;
        }
    }
}