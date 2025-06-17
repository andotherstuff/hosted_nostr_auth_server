// ABOUTME: Stateless NostrPassportServer client - no browser storage, session-based auth
// ABOUTME: Replaces dangerous IndexedDB key storage with secure server-side sessions

import { SessionManager } from './session';
import { NostrAPI } from './api';

console.log("NostrPassportServer stateless client loaded");

interface AuthState {
    isAuthenticated: boolean;
    publicKey: string | null;
    username: string | null;
}

class NostrPassportClient {
    private sessionManager: SessionManager;
    private api: NostrAPI;
    private authState: AuthState = {
        isAuthenticated: false,
        publicKey: null,
        username: null
    };

    constructor() {
        this.sessionManager = new SessionManager();
        this.api = new NostrAPI(this.sessionManager);
    }

    async initialize(): Promise<void> {
        // Check if we have a valid session
        if (await this.sessionManager.isAuthenticated()) {
            await this.loadUserInfo();
            this.updateUI();
        } else {
            this.showLoginForm();
        }
    }

    async login(username: string, password: string, deviceInfo?: any): Promise<boolean> {
        try {
            const success = await this.sessionManager.login(username, password, deviceInfo);
            if (success) {
                await this.loadUserInfo();
                this.updateUI();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        }
    }

    async logout(): Promise<void> {
        await this.sessionManager.logout();
        this.authState = {
            isAuthenticated: false,
            publicKey: null,
            username: null
        };
        this.showLoginForm();
    }

    async signNostrEvent(eventData: any): Promise<string> {
        if (!this.authState.isAuthenticated) {
            throw new Error('Not authenticated');
        }
        
        return await this.api.signEvent(eventData);
    }

    async signMessage(message: string): Promise<string> {
        if (!this.authState.isAuthenticated) {
            throw new Error('Not authenticated');
        }
        
        return await this.api.signMessage(message);
    }

    private async loadUserInfo(): Promise<void> {
        try {
            const userInfo = await this.api.getUserInfo();
            this.authState = {
                isAuthenticated: true,
                publicKey: userInfo.publicKey,
                username: userInfo.username
            };
        } catch (error) {
            console.error('Failed to load user info:', error);
            // Session might be expired
            await this.sessionManager.logout();
            this.showLoginForm();
        }
    }

    private updateUI(): void {
        const statusDiv = document.getElementById('key-status');
        const connectionStringPre = document.getElementById('nip46-connection-string');
        const loginForm = document.getElementById('login-form');
        const mainApp = document.getElementById('main-app');

        if (this.authState.isAuthenticated && this.authState.publicKey) {
            if (statusDiv) {
                statusDiv.textContent = `Authenticated as ${this.authState.username}. Pubkey: ${this.authState.publicKey.substring(0, 10)}...`;
            }
            
            if (connectionStringPre) {
                const workerUrl = window.location.origin;
                connectionStringPre.textContent = `nostrconnect://${this.authState.publicKey}?relay=${workerUrl}`;
            }

            if (loginForm) loginForm.style.display = 'none';
            if (mainApp) mainApp.style.display = 'block';
        }
    }

    private showLoginForm(): void {
        const loginForm = document.getElementById('login-form');
        const mainApp = document.getElementById('main-app');
        const statusDiv = document.getElementById('key-status');

        if (loginForm) loginForm.style.display = 'block';
        if (mainApp) mainApp.style.display = 'none';
        if (statusDiv) statusDiv.textContent = 'Not authenticated. Please log in.';
    }
}

// Initialize the client
let client: NostrPassportClient;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        client = new NostrPassportClient();
        await client.initialize();
        setupEventListeners();
    } catch (error) {
        console.error("Failed to initialize NostrPassportServer client:", error);
        alert("Error initializing client. Please refresh the page.");
    }
});

function setupEventListeners(): void {
    // Login form
    const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
    const usernameInput = document.getElementById('username') as HTMLInputElement;
    const passwordInput = document.getElementById('password') as HTMLInputElement;

    // Main app controls
    const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
    const copyBtn = document.getElementById('copy-connection-string') as HTMLButtonElement;
    const signMessageBtn = document.getElementById('sign-message-btn') as HTMLButtonElement;
    const messageInput = document.getElementById('message-input') as HTMLInputElement;

    if (loginBtn && usernameInput && passwordInput) {
        loginBtn.addEventListener('click', async () => {
            const username = usernameInput.value.trim();
            const password = passwordInput.value;
            
            if (!username || !password) {
                alert('Please enter both username and password.');
                return;
            }

            try {
                loginBtn.disabled = true;
                loginBtn.textContent = 'Logging in...';
                
                const success = await client.login(username, password);
                if (success) {
                    usernameInput.value = '';
                    passwordInput.value = '';
                } else {
                    alert('Invalid credentials. Please try again.');
                }
            } catch (error: any) {
                console.error('Login error:', error);
                alert(`Login failed: ${error.message}`);
            } finally {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Login';
            }
        });

        // Allow Enter key to submit login
        passwordInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                loginBtn.click();
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await client.logout();
            } catch (error) {
                console.error('Logout error:', error);
            }
        });
    }

    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const connectionStringPre = document.getElementById('nip46-connection-string');
            if (connectionStringPre && !connectionStringPre.textContent?.includes('<YOUR_PUBKEY>')) {
                navigator.clipboard.writeText(connectionStringPre.textContent ?? '')
                    .then(() => alert('Connection string copied to clipboard!'))
                    .catch(err => console.error('Failed to copy text: ', err));
            } else {
                alert('Please log in first to get your connection string.');
            }
        });
    }

    if (signMessageBtn && messageInput) {
        signMessageBtn.addEventListener('click', async () => {
            const message = messageInput.value.trim();
            if (!message) {
                alert('Please enter a message to sign.');
                return;
            }

            try {
                signMessageBtn.disabled = true;
                signMessageBtn.textContent = 'Signing...';
                
                const signature = await client.signMessage(message);
                alert(`Message signed successfully!\nSignature: ${signature}`);
                messageInput.value = '';
            } catch (error: any) {
                console.error('Signing error:', error);
                alert(`Signing failed: ${error.message}`);
            } finally {
                signMessageBtn.disabled = false;
                signMessageBtn.textContent = 'Sign Message';
            }
        });
    }
}

// Export for use in other modules
export { NostrPassportClient };