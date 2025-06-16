# ChusMe Auth Server Architecture

## Overview

ChusMe Auth Server is a NIP-46 signing service built on Cloudflare Workers that uses FROST (Flexible Round-Optimized Schnorr Threshold) signatures to provide secure, distributed key management for Nostr clients.

## Architecture Decision: Durable Objects + HTTP API

### Core Components

1. **Main Worker (Stateless Router)**
   - Routes requests (`/auth/*`, `/ceremony/*`)
   - Validates JWT tokens
   - Forwards requests to appropriate Durable Objects

2. **FrostCeremonyDO (Stateful Actor)**  
   - Manages individual FROST ceremony state
   - Each ceremony gets unique DO instance via `operation_id`
   - Handles multi-round protocol coordination
   - Provides strong consistency guarantees

3. **Frost WASM Core**
   - Pure Rust implementation using `zcash/frost-core`
   - Compiled to WASM for Worker runtime
   - Handles all cryptographic operations

## State Management Strategy

### Multi-Key Storage Model
Instead of single JSON blob, ceremony state is distributed across multiple keys:

```
meta: { "status": "KEYGEN_ROUND_1", "participants_required": 3, "participants_joined": ["user_1", "user_2"] }
config: { "threshold": 2, "all_participant_ids": ["user_1", "user_2", "user_3"] }
participant:user_1: { "round1_data": "...", "public_key": "..." }
participant:user_2: { "round1_data": "..." }
```

**Benefits:**
- Avoids 128KB per-key storage limits
- Enables atomic multi-key updates
- Easier debugging and inspection
- Supports larger ceremony sizes

## API Design

### Authentication Flow
```
POST /auth/token
- Exchange credentials for JWT
- Returns short-lived access token (15min) + refresh token

POST /auth/refresh  
- Exchange refresh token for new access token
- Rotates refresh token (single-use security)
```

### Ceremony Flow
```
POST /ceremony/start
- Creates new ceremony with secure operation_id
- Returns unguessable ceremony identifier

POST /ceremony/{operation_id}/round/{round_number}
- Submit participant data for specific round
- Idempotent (safe to retry)
- Validates state transitions and participant authorization
```

## Security Model

### FROST-Specific Security
- **Trusted Dealer Model**: Server generates key shares from imported private key
- **Constant-time operations**: All crypto uses side-channel resistant implementations
- **Secret zeroization**: Memory cleared using `zeroize` crate
- **Non-specific errors**: Prevent information leakage via error messages

### Transport Security
- **Unguessable operation_ids**: Using `crypto.randomUUID()`
- **Participant authorization**: JWT user must match ceremony participant
- **Idempotent operations**: Safe request retry without state corruption
- **Rate limiting**: Prevent DoS on CPU-intensive crypto operations

### Key Derivation
- **HKDF for encryption keys**: Separate password hash from encryption key derivation
- **PBKDF2 for password hashing**: Industry standard with appropriate iterations
- **Unique salts**: Per-user salts for all cryptographic operations

## Migration Strategy

### Phase 0: Foundation (No Production Changes)
1. Build characterization tests for existing WebSocket API
2. Create isolated Rust FROST WASM module
3. Validate crypto logic with test vectors

### Phase 1: Parallel Development
1. Implement JWT authentication in main worker
2. Build FrostCeremonyDO with mocked crypto
3. Create HTTP API handlers and routing

### Phase 2: Integration & Testing
1. Integrate real WASM module into DO
2. End-to-end testing with miniflare
3. Performance benchmarking for Wasm operations

### Phase 3: Migration & Cleanup  
1. Frontend feature flag for API switching
2. Gradual rollout with monitoring
3. Deprecate WebSocket implementation

## Risk Assessment

### Technical Risks
- **DO Cold Starts**: Acceptable latency impact for ceremony initiation
- **CPU Limits**: Wasm crypto operations must complete within Worker timeouts
- **Storage Limits**: Multi-key model mitigates 128KB per-key restrictions

### Security Risks  
- **Memory exposure**: Raw private keys briefly in Worker memory during import
- **Ceremony hijacking**: Mitigated by unguessable operation_ids
- **Replay attacks**: Prevented by idempotent state machine design

### Operational Risks
- **State corruption**: Atomic storage operations prevent partial writes  
- **Participant dropout**: State machine handles incomplete ceremonies
- **Network partitions**: HTTP retries safer than WebSocket reconnection

## Performance Considerations

### Benchmarking Requirements
- WASM module initialization time
- Per-round crypto operation latency  
- DO storage read/write performance
- Memory usage under load

### Optimization Opportunities
- WebSocket upgrade for high-frequency ceremonies
- Result caching in Cloudflare KV
- Precomputed ceremony parameters

## Monitoring & Observability

### Key Metrics
- Ceremony completion rates
- Round transition latencies
- JWT validation failures
- DO cold start frequency

### Alerting Thresholds
- Crypto operation timeouts
- High ceremony failure rates
- Storage limit approaching
- Authentication anomalies