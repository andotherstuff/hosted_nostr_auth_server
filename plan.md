# Plan: Secure Custodial NIP-46 Signer using Cloudflare & FROST

## Goal

To create a **secure custodial NIP-46 signer** hosted on Cloudflare Workers. This service is designed for users who prefer not to manage their own non-custodial key vault but want a secure way to use NIP-46 compatible clients.

## Problem Solved

Provides a simpler alternative to non-custodial solutions like nsec.app, abstracting away key management burdens while aiming for a strong security posture within a custodial framework.

## Architecture Overview

1.  **Cloudflare Worker (`src/index.ts`):** The core backend service.
    *   Handles NIP-46 WebSocket connections from clients.
    *   Manages user authentication (e.g., password-based login).
    *   **Custodially stores and manages FROST signing key fragments/shares** derived from the user's root key. Storage mechanism TBD (Cloudflare Secrets Store, D1 with Worker-side encryption).
    *   Performs cryptographic signing operations using FROST threshold signatures **server-side**.
    *   Requires secure user data storage (likely D1) for authentication and key association.

2.  **Frontend (`public/`):**
    *   Provides a user interface for:
        *   Account registration and login.
        *   Initial key generation or import (securely transferring the root key to the Worker for FROST share generation, then discarding the root key from the Worker's perspective if possible, or storing it securely if needed for recovery/regeneration).
        *   Displaying the NIP-46 connection string (`nostrconnect://...`).
    *   **Does NOT perform client-side encryption/decryption or store keys/fragments.**

3.  **FROST Implementation:**
    *   Integrate a FROST library (compatible with Cloudflare Workers environment) into `src/index.ts`.
    *   The Worker will orchestrate the FROST signing process using the custodially held key shares. The specifics depend on the FROST library and chosen threshold scheme (e.g., 2-of-2 with shares held by different Cloudflare services/regions, or a different threshold).

4.  **(Optional) User Root Key Backup:**
    *   Users *may* be advised to independently back up their original root `nsec` (potentially encrypted using `ncrypt` or similar strong passphrase encryption) before importing it into the service.
    *   This backup is for **user-managed disaster recovery or migration only**.
    *   The service **does not** rely on this backup for day-to-day signing operations, which use the custodial FROST fragments.
    *   Emphasize the importance of storing this backup extremely securely and offline.

## High-Level Development Steps

1.  **[Done]** Basic Project Setup (Worker, Vite Frontend, Wrangler).
2.  **[Done]** Basic NIP-46 WebSocket Handler & Routing Stubs (`connect`, `get_public_key`, `sign_event`, `describe`).
3.  **[Done]** Basic Test Setup (`vitest-pool-workers`).
4.  **Setup User Authentication:**
    *   Choose auth method (password hashing).
    *   Set up database (Cloudflare D1 likely) for user accounts.
    *   Implement registration/login endpoints/logic in the Worker.
    *   Update frontend for auth UI.
5.  **Choose & Implement Secure Key/Fragment Storage:**
    *   Decide between Cloudflare Secrets Store or manual encryption + D1/KV for FROST fragments.
    *   Implement storage/retrieval logic in the Worker.
6.  **Integrate FROST Library:**
    *   Select a suitable FROST library (e.g., compatible JS/WASM library).
    *   Implement logic in the Worker to:
        *   Generate FROST shares from an imported root key.
        *   Securely store these shares.
        *   Orchestrate the FROST signing ceremony when a `sign_event` request arrives.
7.  **Refactor NIP-46 Methods (`src/index.ts`):**
    *   `connect`: Authenticate the user.
    *   `get_public_key`: Retrieve the user's public key associated with the custodial FROST setup.
    *   `sign_event`: Trigger the server-side FROST signing process.
    *   `describe`: Update with methods actually supported by the custodial FROST setup.
8.  **Refactor Frontend (`public/`):**
    *   Remove all client-side crypto (encryption/decryption/signing/storage).
    *   Implement auth UI.
    *   Implement UI for initial key import/generation (interacting with Worker).
9.  **Update Tests:** Adapt tests (`test/index.spec.ts`) to cover authentication, server-side signing logic, and FROST interactions (mocking where necessary).
10. **Security Review & Hardening:** Thoroughly review authentication, key storage, FROST implementation, and access controls.
11. **Deployment:** Configure `wrangler.jsonc` for production deployment.

## Key Decisions Pending

*   Specific user authentication flow.
*   Secure storage mechanism for FROST fragments (Secrets vs. Encrypted D1/KV).
*   Choice of FROST library and threshold configuration.
*   Handling of initial root key import/generation and subsequent discarding/storage. 