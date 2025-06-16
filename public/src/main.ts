// Frontend JavaScript logic (public/src/main.ts)
import { openDB, IDBPDatabase } from 'idb';
// Import crypto libs (ensure they are installed)
// import * as secp from '@noble/secp256k1';
// import { argon2id } from '@scure/argon2';
// import { chacha20poly1305 } from '@noble/chacha20poly1305';

console.log("Main script loaded via Vite.");

const DB_NAME = 'chusme-auth-vault';
const DB_VERSION = 1;
const KEY_STORE_NAME = 'encryptedKeys';

interface EncryptedKeyRecord {
    id: number; // Usually just 1 for the single user key
    publicKeyHex: string;
    encryptedNsecBlob: Uint8Array; // Store blob as Uint8Array
    argonSalt: Uint8Array;
}

let db: IDBPDatabase | null = null;

async function initDB(): Promise<IDBPDatabase> {
    if (db) return db;
    db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
                db.createObjectStore(KEY_STORE_NAME, { keyPath: 'id' });
                console.log(`Object store ${KEY_STORE_NAME} created.`);
            }
        },
    });
    console.log("Database initialized.");
    return db;
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
    } catch (error) {
        console.error("Failed to initialize database:", error);
        alert("Error initializing local storage. Key management will not work.");
        // Disable buttons or show error state
        return;
    }

    const generateBtn = document.getElementById('generate-key') as HTMLButtonElement;
    const loadBtn = document.getElementById('load-key') as HTMLButtonElement;
    const copyBtn = document.getElementById('copy-connection-string') as HTMLButtonElement;
    const passphraseInput = document.getElementById('passphrase') as HTMLInputElement;
    const keyStatusDiv = document.getElementById('key-status');
    const connectionStringPre = document.getElementById('nip46-connection-string');

    // Add checks to ensure elements exist
    if (!generateBtn || !loadBtn || !copyBtn || !passphraseInput || !keyStatusDiv || !connectionStringPre) {
        console.error("One or more required HTML elements not found.");
        alert("Initialization Error: UI elements missing. Cannot proceed.");
        return; 
    }

    // --- Event Listeners ---

    generateBtn.addEventListener('click', async () => {
        const passphrase = passphraseInput.value;
        if (!passphrase) {
            alert('Please enter a passphrase.');
            return;
        }
        console.log("Generate & Encrypt Key clicked");
        keyStatusDiv.textContent = 'Generating key...'; // Now safe to access

        try {
            // TODO: Implement key generation (e.g., secp.utils.randomPrivateKey())
            const privateKeyBytes = new Uint8Array(32).fill(1); // STUB: Replace with actual generation
            const publicKeyBytes = new Uint8Array(33).fill(2); // STUB: Replace with actual derivation
            const publicKeyHex = bytesToHex(publicKeyBytes);

            // TODO: Implement KDF (Argon2id)
            const salt = window.crypto.getRandomValues(new Uint8Array(16));
            const derivedKey = new Uint8Array(32).fill(3); // STUB: Replace with argon2id result
            console.log("Derived key (stub)", derivedKey);

            // TODO: Implement encryption (ChaCha20-Poly1305)
            // const cipher = chacha20poly1305(derivedKey);
            // const nonce = window.crypto.getRandomValues(new Uint8Array(12));
            // const encryptedNsecBlob = cipher.encrypt(nonce, privateKeyBytes);
            const encryptedNsecBlob = new Uint8Array(privateKeyBytes.length + 16).fill(4); // STUB

            // TODO: Store encrypted blob, pubkey, salt in IndexedDB
            const record: EncryptedKeyRecord = {
                id: 1,
                publicKeyHex,
                encryptedNsecBlob,
                argonSalt: salt
            };
            if (!db) throw new Error("Database not initialized"); // Add DB null check
            await db.put(KEY_STORE_NAME, record);

            keyStatusDiv.textContent = `Key generated & encrypted. Pubkey: ${publicKeyHex.substring(0, 10)}...`;
            updateConnectionString(publicKeyHex);
            alert('Key generation complete. Encrypted key stored locally.');

        } catch (error: any) { // Added type for error
            console.error("Key generation/encryption failed:", error);
            keyStatusDiv.textContent = 'Error generating key.';
            alert(`Error: ${error.message}`);
        }
    });

    loadBtn.addEventListener('click', async () => {
        const passphrase = passphraseInput.value;
        if (!passphrase) {
            alert('Please enter a passphrase.');
            return;
        }
        console.log("Load Encrypted Key clicked");
        keyStatusDiv.textContent = 'Loading key...'; // Safe

        try {
            // TODO: Load encrypted blob from IndexedDB
            if (!db) throw new Error("Database not initialized"); // Add DB null check
            const record = await db.get(KEY_STORE_NAME, 1); // Remove generic type
            if (!record) {
                throw new Error("No key found in local storage.");
            }

            // Type assertion might be needed here if inference isn't enough
            const keyRecord = record as EncryptedKeyRecord; 

            // TODO: Implement KDF (Argon2id)
            const derivedKey = new Uint8Array(32).fill(3); // STUB: Replace with argon2id result

            // TODO: Implement decryption (ChaCha20-Poly1305)
            // const cipher = chacha20poly1305(derivedKey);
            // const nonce = keyRecord.encryptedNsecBlob.slice(0, 12); // Assuming nonce prepended
            // const ciphertext = keyRecord.encryptedNsecBlob.slice(12);
            // const decryptedNsecBytes = cipher.decrypt(nonce, ciphertext);
            const decryptedNsecBytes = new Uint8Array(32).fill(1); // STUB

            console.log("Decrypted Nsec (stub - DO NOT LOG IN PROD):", bytesToHex(decryptedNsecBytes));

            keyStatusDiv.textContent = `Key loaded. Pubkey: ${keyRecord.publicKeyHex.substring(0, 10)}...`;
            updateConnectionString(keyRecord.publicKeyHex);
            alert('Key loading complete.');

        } catch (error: any) { // Added type for error
            console.error("Key loading/decryption failed:", error);
            keyStatusDiv.textContent = 'Error loading key.';
            alert(`Error: ${error.message}`);
        }
    });

    copyBtn.addEventListener('click', () => {
        if (connectionStringPre.textContent?.includes('<YOUR_PUBKEY>')) { // Added optional chaining
            alert("Please generate or load a key first.");
            return;
        }
        navigator.clipboard.writeText(connectionStringPre.textContent ?? '') // Added nullish coalescing
            .then(() => alert('Connection string copied to clipboard!'))
            .catch(err => console.error('Failed to copy text: ', err));
    });

    // --- Initial Load --- 
    // Try to load existing key info to populate fields on page load
    try {
        if (!db) throw new Error("Database not initialized"); // Add DB null check
        const record = await db.get(KEY_STORE_NAME, 1); // Remove generic type
        if (record) {
             // Type assertion might be needed here if inference isn't enough
            const keyRecord = record as EncryptedKeyRecord;
            keyStatusDiv.textContent = `Existing key found. Pubkey: ${keyRecord.publicKeyHex.substring(0, 10)}...`; // Safe
            updateConnectionString(keyRecord.publicKeyHex);
        } else {
            keyStatusDiv.textContent = 'Status: No key loaded.'; // Safe
            updateConnectionString(); // Show placeholder
        }
    } catch (error: any) { // Added type for error
         console.error("Failed to load initial key state:", error);
         keyStatusDiv.textContent = 'Error loading key status.'; // Safe
         updateConnectionString(); // Show placeholder
    }
});

// --- Utility Functions ---

function updateConnectionString(publicKeyHex = '<YOUR_PUBKEY>') {
    const connectionStringPre = document.getElementById('nip46-connection-string');
    if (connectionStringPre) { // Add null check
        const workerUrl = window.location.origin;
        connectionStringPre.textContent = `nostrconnect://${publicKeyHex}?relay=${workerUrl}`;
    }
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// function hexToBytes(hex: string): Uint8Array { ... }