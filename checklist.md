# Project Checklist

Based on `plan.md`.

## Remaining Development Steps

- [ ] **4. Setup User Authentication:**
    - [ ] Choose auth method (password hashing).
    - [ ] Set up database (Cloudflare D1 likely) for user accounts.
    - [ ] Implement registration/login endpoints/logic in the Worker.
    - [ ] Update frontend for auth UI.
- [ ] **5. Choose & Implement Secure Key/Fragment Storage:**
    - [ ] Decide between Cloudflare Secrets Store or manual encryption + D1/KV for FROST fragments.
    - [ ] Implement storage/retrieval logic in the Worker.
- [ ] **6. Integrate FROST Library:**
    - [ ] Select a suitable FROST library (e.g., compatible JS/WASM library).
    - [ ] Implement logic in the Worker to:
        - [ ] Generate FROST shares from an imported root key.
        - [ ] Securely store these shares.
        - [ ] Orchestrate the FROST signing ceremony when a `sign_event` request arrives.
- [ ] **7. Refactor NIP-46 Methods (`src/index.ts`):**
    - [ ] `connect`: Authenticate the user.
    - [ ] `get_public_key`: Retrieve the user's public key associated with the custodial FROST setup.
    - [ ] `sign_event`: Trigger the server-side FROST signing process.
    - [ ] `describe`: Update with methods actually supported by the custodial FROST setup.
- [ ] **8. Refactor Frontend (`public/`):**
    - [ ] Remove all client-side crypto (encryption/decryption/signing/storage).
    - [ ] Implement auth UI.
    - [ ] Implement UI for initial key import/generation (interacting with Worker).
- [ ] **9. Update Tests:**
    - [ ] Adapt tests (`test/index.spec.ts`) to cover authentication, server-side signing logic, and FROST interactions (mocking where necessary).
- [ ] **10. Security Review & Hardening:**
    - [ ] Thoroughly review authentication, key storage, FROST implementation, and access controls.
- [ ] **11. Deployment:**
    - [ ] Configure `wrangler.jsonc` for production deployment.

## Key Decisions Pending

- [ ] Specific user authentication flow.
- [ ] Secure storage mechanism for FROST fragments (Secrets vs. Encrypted D1/KV).
- [ ] Choice of FROST library and threshold configuration.
- [ ] Handling of initial root key import/generation and subsequent discarding/storage. 