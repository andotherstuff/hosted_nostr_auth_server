# GitHub Issues for ChusMe Auth Server Migration

## Phase 0: Foundation & De-risking

### Issue #1: Create characterization test suite for existing WebSocket FROST ceremony
**Priority**: Critical  
**Labels**: `phase-0`, `testing`, `regression-prevention`

**Description**:
Create comprehensive test suite against the current WebSocket implementation to prevent regressions during migration.

**Acceptance Criteria**:
- [ ] Test successful 2-of-2 FROST keygen ceremony
- [ ] Test successful signing ceremony with generated keys
- [ ] Test participant dropout scenarios
- [ ] Test invalid data handling
- [ ] Test concurrent ceremony handling
- [ ] All tests pass against current implementation
- [ ] Test results documented as baseline

**Testing Strategy**:
- Use existing WebSocket client to simulate multiple participants
- Capture all message exchanges for replay testing
- Document expected timing and error behaviors

---

### Issue #2: Implement core FROST logic in Wasm module
**Priority**: Critical  
**Labels**: `phase-0`, `crypto`, `wasm`, `security`

**Description**:
Create new Rust crate using `zcash/frost-core` v2.1.0 and compile to WASM for Worker runtime.

**Acceptance Criteria**:
- [ ] New Rust crate `frost-wasm-core` created
- [ ] Dependencies: `zcash/frost-core` v2.1.0, `zeroize`, `wasm-bindgen`
- [ ] Functions implemented:
  - [ ] `create_keygen_state(participants: u32, threshold: u32) -> State`
  - [ ] `handle_keygen_round_1(state: State, participant_id: String, data: Vec<u8>) -> Result<(State, Vec<u8>), Error>`
  - [ ] `handle_keygen_round_2(state: State, participant_id: String, data: Vec<u8>) -> Result<(State, Option<PublicKey>), Error>`
  - [ ] `create_sign_state(key_shares: Vec<u8>, message: Vec<u8>) -> State`
  - [ ] `handle_sign_round_1(state: State, participant_id: String, data: Vec<u8>) -> Result<(State, Vec<u8>), Error>`
  - [ ] `handle_sign_round_2(state: State, participant_id: String, data: Vec<u8>) -> Result<(State, Option<Signature>), Error>`
- [ ] All secret data properly zeroized using `zeroize` crate
- [ ] Compiles to WASM using `wasm-pack build --target web`
- [ ] Unit tests with known test vectors
- [ ] Error types properly defined and serializable
- [ ] Constant-time operations verified

**Security Requirements**:
- All cryptographic operations must be constant-time
- No secret-dependent branching
- Proper error handling without information leakage
- Memory cleared after use

---

### Issue #3: Configure local testing environment with Miniflare
**Priority**: High  
**Labels**: `phase-0`, `dev-environment`, `testing`

**Description**:
Set up local development environment for testing Workers and Durable Objects.

**Acceptance Criteria**:
- [ ] `miniflare` configured in `vitest.config.ts`
- [ ] Can instantiate main Worker in tests
- [ ] Can create and interact with Durable Objects
- [ ] `wrangler.toml` properly configured with DO bindings
- [ ] Simple health check test passes
- [ ] Environment loads secrets and bindings correctly
- [ ] Documentation for running tests locally

**Configuration Requirements**:
```typescript
// vitest.config.ts example
export default defineConfig({
  test: {
    environment: 'miniflare',
    environmentOptions: {
      bindings: { FROST_DO: 'FrostCeremonyDO' },
      durableObjects: {
        FROST_DO: 'FrostCeremonyDO'
      }
    }
  }
});
```

---

## Phase 1: HTTP API Foundation

### Issue #4: Implement JWT authentication in main worker
**Priority**: Critical  
**Labels**: `phase-1`, `auth`, `security`, `jwt`

**Description**:
Implement secure JWT-based authentication with refresh tokens for the new HTTP API.

**Acceptance Criteria**:
- [ ] `POST /auth/token` endpoint implemented
  - [ ] Validates username/password against D1 database
  - [ ] Returns short-lived access token (15 min expiry)
  - [ ] Returns secure refresh token (7 day expiry, HttpOnly cookie)
  - [ ] Uses Worker Secrets for JWT signing key
- [ ] `POST /auth/refresh` endpoint implemented
  - [ ] Validates refresh token
  - [ ] Issues new access token
  - [ ] Rotates refresh token (single-use security)
- [ ] JWT validation middleware created
  - [ ] Validates token signature and expiry
  - [ ] Extracts user claims (sub, iat, exp)
  - [ ] Attaches user info to request object
  - [ ] Returns 401 for invalid/expired tokens
- [ ] Uses `jose` library for JWT operations
- [ ] Proper error handling without information leakage
- [ ] Rate limiting on auth endpoints (5 req/min per IP)

**Security Requirements**:
- JWT secret stored in Worker Secrets
- Refresh tokens in HttpOnly, Secure, SameSite cookies
- Constant-time signature validation
- No secret material in logs

---

### Issue #5: Scaffold FrostCeremonyDO with mock state machine
**Priority**: Critical  
**Labels**: `phase-1`, `durable-objects`, `state-management`

**Description**:
Create FrostCeremonyDO class with complete state machine logic but mocked crypto operations.

**Acceptance Criteria**:
- [ ] `FrostCeremonyDO` class created with proper TypeScript types
- [ ] Multi-key storage pattern implemented:
  - [ ] `meta`: ceremony status and progress tracking
  - [ ] `config`: threshold and participant configuration
  - [ ] `participant:{id}`: individual participant data
- [ ] HTTP request routing implemented:
  - [ ] `GET /status` - returns ceremony status
  - [ ] `POST /round/1` - handles round 1 submissions
  - [ ] `POST /round/2` - handles round 2 submissions
  - [ ] `POST /sign` - handles signing requests
- [ ] State transition validation:
  - [ ] Rejects out-of-order requests (round 2 before round 1)
  - [ ] Validates participant authorization
  - [ ] Tracks round completion status
- [ ] Idempotent request handling:
  - [ ] Duplicate submissions return original response
  - [ ] No state corruption from retries
- [ ] Atomic storage operations:
  - [ ] Multiple keys updated in single transaction
  - [ ] Rollback on partial failures
- [ ] Mock crypto operations that simulate:
  - [ ] Key generation ceremony (2 rounds)
  - [ ] Signing ceremony (2 rounds)
  - [ ] Proper state transitions and outputs
- [ ] Comprehensive unit tests for all state transitions
- [ ] Error handling for invalid states and malformed requests

**Storage Schema**:
```typescript
interface CeremonyMeta {
  status: 'INIT' | 'KEYGEN_ROUND_1' | 'KEYGEN_ROUND_2' | 'READY' | 'SIGNING' | 'COMPLETE';
  participants_required: number;
  participants_joined: string[];
  threshold: number;
  created_at: number;
}

interface ParticipantData {
  user_id: string;
  round1_data?: string;
  round2_data?: string;
  public_key?: string;
  joined_at: number;
}
```

---

### Issue #6: Implement main worker routing and DO integration
**Priority**: High  
**Labels**: `phase-1`, `routing`, `integration`

**Description**:
Create main worker that routes requests to appropriate Durable Objects with proper authentication.

**Acceptance Criteria**:
- [ ] Router implemented using `itty-router` or similar
- [ ] Route handling:
  - [ ] `POST /auth/*` - handled directly in main worker
  - [ ] `POST /ceremony/start` - creates new ceremony, returns operation_id
  - [ ] `POST /ceremony/{operation_id}/*` - forwards to appropriate DO
- [ ] Secure operation_id generation:
  - [ ] Uses `crypto.randomUUID()` for unguessable IDs
  - [ ] Returns operation_id in ceremony start response
  - [ ] Maps operation_id to DO instance using `idFromName()`
- [ ] Request forwarding:
  - [ ] Validates JWT before forwarding to DO
  - [ ] Includes user claims in forwarded request
  - [ ] Preserves request body and headers
  - [ ] Returns DO response unchanged
- [ ] Error handling:
  - [ ] 401 for authentication failures
  - [ ] 404 for non-existent ceremonies
  - [ ] 500 for DO or system errors
  - [ ] Proper error logging without secret exposure
- [ ] CORS handling for web clients
- [ ] Request/response logging for debugging

**API Schema**:
```typescript
POST /ceremony/start
Response: { "operation_id": "uuid-here", "status": "INIT" }

POST /ceremony/{operation_id}/round/1
Headers: Authorization: Bearer <jwt>
Body: { "participant_id": "user_123", "payload": "crypto_data" }
Response: { "status": "success", "next_round": 2, "data": "response_data" }
```

---

## Phase 2: Integration & Security

### Issue #7: Integrate WASM crypto module into FrostCeremonyDO
**Priority**: Critical  
**Labels**: `phase-2`, `integration`, `crypto`, `wasm`

**Description**:
Replace mocked crypto operations with real WASM module calls in the Durable Object.

**Acceptance Criteria**:
- [ ] WASM module loading in DO:
  - [ ] Module instantiated in DO constructor
  - [ ] Proper error handling for loading failures
  - [ ] Memory management for WASM instance
- [ ] Data serialization:
  - [ ] TypeScript ↔ WASM data conversion
  - [ ] Proper error handling for serialization failures  
  - [ ] Type safety for all interfaces
- [ ] Crypto operation integration:
  - [ ] Replace all mocked functions with real WASM calls
  - [ ] Maintain existing state machine logic
  - [ ] Preserve idempotent behavior
  - [ ] Handle WASM errors gracefully
- [ ] Performance monitoring:
  - [ ] Log timing for crypto operations
  - [ ] Monitor memory usage
  - [ ] Track success/failure rates
- [ ] End-to-end testing:
  - [ ] Complete keygen ceremony with real crypto
  - [ ] Complete signing ceremony with generated keys
  - [ ] Verify cryptographic correctness
  - [ ] Performance benchmarks within acceptable limits

**Performance Requirements**:
- Keygen ceremony: < 500ms per round
- Signing ceremony: < 200ms per round  
- Memory usage: < 50MB per ceremony
- No blocking of DO event loop

---

### Issue #8: Implement security hardening measures
**Priority**: High  
**Labels**: `phase-2`, `security`, `rate-limiting`, `validation`

**Description**:
Add comprehensive security measures including rate limiting, input validation, and proper key derivation.

**Acceptance Criteria**:
- [ ] Rate limiting implemented:
  - [ ] `/ceremony/start`: 5 requests/min per IP
  - [ ] `/ceremony/{id}/round/*`: 30 requests/min per JWT
  - [ ] `/auth/token`: 10 requests/min per IP
  - [ ] Configurable limits via environment variables
  - [ ] Proper error responses (429 Too Many Requests)
- [ ] Input validation:
  - [ ] Schema validation using `zod` for all endpoints
  - [ ] Request size limits (max 10KB per request)
  - [ ] Participant ID format validation
  - [ ] Cryptographic data format validation
  - [ ] SQL injection prevention
- [ ] HKDF key derivation:
  - [ ] Separate encryption key from password hash
  - [ ] Use password hash as HKDF input material
  - [ ] Unique salt per user for key derivation
  - [ ] 32-byte AES-256-GCM keys generated
- [ ] Enhanced error handling:
  - [ ] No sensitive information in error messages
  - [ ] Structured error logging for debugging
  - [ ] Rate limit bypass detection and logging
  - [ ] Correlation IDs for request tracking
- [ ] Request sanitization:
  - [ ] HTML/script tag removal
  - [ ] Unicode normalization
  - [ ] Path traversal prevention

**Key Derivation Implementation**:
```typescript
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

// Password hash as input material
const passwordHash = await pbkdf2(password, userSalt, 100000);
// Derive encryption key
const encryptionKey = hkdf(sha256, passwordHash, salt, 'aes-256-gcm-key', 32);
```

---

## Phase 3: Testing & Validation

### Issue #9: Implement comprehensive test suite
**Priority**: Critical  
**Labels**: `phase-3`, `testing`, `e2e`, `performance`

**Description**:
Create full test coverage including unit, integration, and end-to-end tests with performance benchmarking.

**Acceptance Criteria**:
- [ ] Unit tests:
  - [ ] WASM module functions (Rust tests)
  - [ ] DO state machine logic (TypeScript tests)
  - [ ] JWT middleware validation
  - [ ] Input validation functions  
  - [ ] Key derivation functions
  - [ ] 90%+ code coverage
- [ ] Integration tests:
  - [ ] Worker → DO request routing
  - [ ] Authentication flow end-to-end
  - [ ] State persistence across DO lifecycle
  - [ ] Error handling scenarios
  - [ ] Rate limiting behavior
- [ ] End-to-end tests:
  - [ ] Multi-participant keygen ceremony (2-of-2, 3-of-5)
  - [ ] Signing with generated keys
  - [ ] Concurrent ceremony handling
  - [ ] Participant dropout scenarios
  - [ ] Network failure simulation
- [ ] Performance benchmarks:
  - [ ] WASM initialization time
  - [ ] Per-round crypto operation latency
  - [ ] DO storage read/write performance
  - [ ] Memory usage under load
  - [ ] Concurrent ceremony capacity
- [ ] Security tests:
  - [ ] JWT token manipulation attempts
  - [ ] Rate limiting bypass attempts
  - [ ] Input validation edge cases
  - [ ] Participant authorization bypass attempts
- [ ] Regression tests:
  - [ ] All characterization tests still pass
  - [ ] Performance within acceptable bounds
  - [ ] No security vulnerabilities introduced

**Performance Targets**:
- Keygen ceremony: < 1 second total (2-of-2)
- Signing ceremony: < 500ms total
- Concurrent ceremonies: 10+ without degradation
- Memory usage: < 100MB for 10 concurrent ceremonies

---

## Phase 4: Migration & Rollout

### Issue #10: Implement frontend feature flag system
**Priority**: High  
**Labels**: `phase-4`, `frontend`, `migration`, `feature-flags`

**Description**:
Add feature flag system to frontend for safe migration between WebSocket and HTTP APIs.

**Acceptance Criteria**:
- [ ] Environment-based feature flag:
  - [ ] `REACT_APP_USE_HTTP_API` environment variable
  - [ ] Build-time flag configuration
  - [ ] Default to `false` (WebSocket) for safety
- [ ] Service abstraction layer:
  - [ ] Common interface for both API types
  - [ ] Factory pattern for service creation
  - [ ] Type-safe API contracts
- [ ] HTTP API client implementation:
  - [ ] JWT token management (access + refresh)
  - [ ] Automatic token refresh on 401
  - [ ] Request retry logic with backoff
  - [ ] Error handling and user feedback
- [ ] Compatibility layer:
  - [ ] Same user experience regardless of API
  - [ ] Consistent error messages
  - [ ] Preserved ceremony state tracking
- [ ] Migration utilities:
  - [ ] In-progress ceremony detection
  - [ ] Graceful API switching
  - [ ] State migration if needed
- [ ] Testing:
  - [ ] Both API implementations work identically
  - [ ] Feature flag switching works without refresh
  - [ ] No data loss during switching

**Implementation Example**:
```typescript
// Service factory
const createApiService = () => {
  return process.env.REACT_APP_USE_HTTP_API === 'true' 
    ? new HttpApiService()
    : new WebSocketApiService();
};

// Common interface
interface ApiService {
  startCeremony(type: 'keygen' | 'sign'): Promise<string>;
  submitRound(operationId: string, roundData: any): Promise<any>;
  getCeremonyStatus(operationId: string): Promise<Status>;
}
```

---

### Issue #11: Production deployment and monitoring setup
**Priority**: High  
**Labels**: `phase-4`, `deployment`, `monitoring`, `observability`

**Description**:
Deploy new HTTP API to production with comprehensive monitoring and rollback capabilities.

**Acceptance Criteria**:
- [ ] Production deployment:
  - [ ] Cloudflare Workers deployment pipeline
  - [ ] Environment-specific configurations
  - [ ] Secret management (JWT keys, database URLs)
  - [ ] DO bindings properly configured
  - [ ] Custom domain and SSL setup
- [ ] Monitoring and alerting:
  - [ ] Cloudflare Analytics integration
  - [ ] Custom metrics dashboard:
    - [ ] Ceremony success/failure rates
    - [ ] Round completion times
    - [ ] JWT validation failures
    - [ ] Rate limiting triggers
    - [ ] DO cold start frequency
  - [ ] Alert thresholds:
    - [ ] Ceremony failure rate > 5%
    - [ ] Average response time > 2 seconds
    - [ ] Error rate > 1%
    - [ ] Rate limiting > 100 hits/hour
- [ ] Rollout strategy:
  - [ ] Canary deployment (5% traffic)
  - [ ] Gradual rollout (5% → 25% → 50% → 100%)
  - [ ] A/B testing capabilities
  - [ ] Automatic rollback triggers
- [ ] Rollback procedures:
  - [ ] Feature flag disable (instant)
  - [ ] Worker deployment rollback
  - [ ] Database migration rollback plan
  - [ ] Communication plan for users
- [ ] Performance monitoring:
  - [ ] Response time percentiles (p50, p95, p99)
  - [ ] Throughput measurements
  - [ ] Resource utilization tracking
  - [ ] Cost analysis and optimization

**Monitoring Dashboard**:
- Real-time ceremony success rate
- API response time trends  
- Error rate by endpoint
- User adoption of new API
- Resource usage and costs

---

### Issue #12: Legacy WebSocket API deprecation
**Priority**: Medium  
**Labels**: `phase-4`, `cleanup`, `deprecation`

**Description**:
Gracefully deprecate and remove the legacy WebSocket implementation after successful migration.

**Acceptance Criteria**:
- [ ] Deprecation notice:
  - [ ] 30-day advance notice to users
  - [ ] Documentation updates with migration guide
  - [ ] Deprecation headers in WebSocket responses
  - [ ] Email notification to registered users
- [ ] Migration support:
  - [ ] Help documentation for API changes
  - [ ] Example code for new HTTP API
  - [ ] Migration assistance for integration partners
  - [ ] FAQ for common migration issues
- [ ] Gradual shutdown:
  - [ ] Warning phase (30 days)
  - [ ] Read-only phase (7 days)  
  - [ ] Complete shutdown
  - [ ] Redirect to HTTP API endpoints
- [ ] Code cleanup:
  - [ ] Remove WebSocket handler code
  - [ ] Remove WebSocket dependencies
  - [ ] Remove frontend WebSocket client
  - [ ] Remove feature flag system
  - [ ] Update all documentation
- [ ] Final validation:
  - [ ] No remaining WebSocket references
  - [ ] All tests pass without WebSocket code
  - [ ] Performance improvement measured
  - [ ] Reduced bundle size confirmed

---

## Phase 5: Optimization & Documentation

### Issue #13: Performance optimization and monitoring
**Priority**: Medium  
**Labels**: `phase-5`, `optimization`, `performance`

**Description**:
Optimize system performance based on production metrics and implement additional monitoring.

**Acceptance Criteria**:
- [ ] Performance analysis:
  - [ ] Identify bottlenecks from production data
  - [ ] WASM optimization opportunities
  - [ ] Storage operation optimization
  - [ ] Network latency analysis
- [ ] Optimization implementation:
  - [ ] WASM bundle size reduction
  - [ ] Storage access pattern optimization
  - [ ] Caching strategy for frequent operations
  - [ ] Batch operations where possible
- [ ] Advanced monitoring:
  - [ ] Custom metrics collection
  - [ ] Distributed tracing setup
  - [ ] Performance regression detection
  - [ ] Capacity planning metrics
- [ ] Documentation updates:
  - [ ] API documentation
  - [ ] Architecture documentation
  - [ ] Operational runbooks
  - [ ] Troubleshooting guides

---

### Issue #14: Security audit and compliance
**Priority**: High  
**Labels**: `phase-5`, `security`, `audit`, `compliance`

**Description**:
Conduct comprehensive security review and ensure compliance with security best practices.

**Acceptance Criteria**:
- [ ] Security audit:
  - [ ] Third-party security review
  - [ ] Penetration testing
  - [ ] Cryptographic implementation review
  - [ ] Access control validation
- [ ] Compliance verification:
  - [ ] OWASP security guidelines compliance
  - [ ] Cryptographic standards compliance
  - [ ] Privacy policy updates
  - [ ] Data handling procedures
- [ ] Security improvements:
  - [ ] Address any findings from audit
  - [ ] Implement additional security measures
  - [ ] Update security documentation
  - [ ] Establish ongoing security processes
- [ ] Incident response:
  - [ ] Security incident response plan
  - [ ] Breach notification procedures
  - [ ] Recovery and rollback procedures
  - [ ] Communication templates

---

## GitHub Project Organization

### Milestones
- **Phase 0 Complete**: Foundational work done (Issues #1-3)
- **Phase 1 Complete**: HTTP API foundation ready (Issues #4-6)  
- **Phase 2 Complete**: Full integration achieved (Issues #7-8)
- **Phase 3 Complete**: Testing and validation done (Issue #9)
- **Phase 4 Complete**: Migration successful (Issues #10-12)
- **Phase 5 Complete**: Optimization and documentation (Issues #13-14)

### Labels
- `phase-0`, `phase-1`, `phase-2`, `phase-3`, `phase-4`, `phase-5`
- `critical`, `high-priority`, `medium-priority`, `low-priority`
- `crypto`, `security`, `testing`, `performance`, `documentation`
- `frontend`, `backend`, `wasm`, `durable-objects`
- `bug`, `enhancement`, `refactor`, `cleanup`

### Board Setup
- **Backlog**: All created issues
- **In Progress**: Currently being worked on
- **Review**: Ready for code review
- **Testing**: In testing phase
- **Done**: Completed and verified

This comprehensive issue set provides clear, actionable tasks for the entire migration project with proper acceptance criteria, security considerations, and testing requirements.