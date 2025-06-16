# ChusMe Auth Server Implementation Plan

## Executive Summary

This plan details the migration from the current WebSocket-based implementation to a robust HTTP API using Cloudflare Durable Objects for FROST ceremony state management.

## Phase 0: Foundation & De-risking (Week 1-2)

### Critical Path Items

#### 1. Characterization Testing
**Goal**: Create safety net for existing functionality
- Write comprehensive test suite against current WebSocket implementation
- Cover successful FROST ceremony end-to-end
- Test failure modes (participant dropout, invalid data)
- Document expected behaviors as regression prevention

#### 2. FROST WASM Module Development  
**Goal**: Isolate and validate cryptographic core
- Create new Rust crate `frost-wasm-core`
- Integrate `zcash/frost-core` v2.1.0
- Implement functions:
  - `create_keygen_state(participants, threshold)`
  - `handle_keygen_round(state, participant_id, round_data)`
  - `create_sign_state(key_shares, message)`
  - `handle_sign_round(state, participant_id, round_data)`
- Use `zeroize` crate for secret data cleanup
- Build with `wasm-pack` for Worker runtime
- Create unit tests with known test vectors

#### 3. Local Development Environment
**Goal**: Enable rapid iteration and testing
- Configure `miniflare` for local Worker testing
- Set up `vitest` with Durable Objects support
- Create `wrangler.toml` configuration for DO bindings
- Validate local environment can instantiate DOs

## Phase 1: HTTP API Foundation (Week 3-4)

### Authentication System

#### JWT Implementation
```typescript
// Main worker endpoints
POST /auth/token
POST /auth/refresh

// JWT validation middleware for protected routes
// Short-lived access tokens (15min) + rotating refresh tokens
```

**Security Requirements:**
- Store JWT secrets in Worker Secrets
- Validate all standard claims (exp, iss, aud, nbf)
- Use `jose` library for robust JWT handling
- Implement proper error handling without information leakage

### Durable Objects Scaffolding

#### FrostCeremonyDO Class
```typescript
export class FrostCeremonyDO {
  constructor(state: DurableObjectState) {}
  
  async fetch(request: Request): Promise<Response> {
    // Route: /round/{round_number}
    // Route: /sign
    // Route: /status
  }
}
```

**State Management:**
- Multi-key storage pattern:
  - `meta`: Ceremony status and progress
  - `config`: Threshold and participant configuration  
  - `participant:{id}`: Individual participant data
- Atomic updates across multiple keys
- Idempotent request handling
- State transition validation

## Phase 2: Integration & Security (Week 5-6)

### WASM Integration
- Load compiled WASM module in Durable Object
- Handle serialization between TypeScript and Rust
- Implement error handling and type safety
- Add performance monitoring for crypto operations

### Security Hardening

#### Rate Limiting
```typescript
// Protect CPU-intensive endpoints
POST /ceremony/start -> 5 req/min per IP
POST /ceremony/{id}/round/{n} -> 30 req/min per JWT
```

#### Input Validation
- Strict schema validation using `zod` or `yup`
- Sanitize all user inputs
- Validate participant authorization per ceremony
- Implement request size limits

#### Key Derivation (HKDF)
```typescript
// Separate encryption key derivation from password hashing
const passwordHash = await pbkdf2(password, userSalt, iterations);
const encryptionKey = await hkdf(passwordHash, 'encryption-key', 32);
```

## Phase 3: Testing & Validation (Week 7)

### Testing Strategy

#### Unit Tests
- WASM module functions (Rust)
- DO state transitions (TypeScript)
- JWT middleware validation
- Input validation logic

#### Integration Tests  
- Worker → DO request routing
- Authentication flow end-to-end
- State persistence across DO lifecycle
- Error handling scenarios

#### End-to-End Tests
```typescript
// Simulate multi-participant ceremony
describe('FROST Ceremony E2E', () => {
  test('3-of-5 keygen ceremony', async () => {
    // Create 5 virtual participants
    // Each makes requests through test client
    // Validate successful key generation
    // Benchmark performance metrics
  });
});
```

#### Performance Benchmarking
- WASM initialization latency
- Per-round crypto operation timing
- DO storage read/write performance
- Memory usage under concurrent load

## Phase 4: Migration & Rollout (Week 8-9)

### Feature Flag Implementation
```typescript
// Frontend configuration
const USE_HTTP_API = process.env.REACT_APP_USE_HTTP_API === 'true';

// Service layer abstraction
const apiService = USE_HTTP_API ? httpApiService : websocketApiService;
```

### Rollout Strategy
1. **Internal Testing**: Enable flag for development team
2. **Staged Rollout**: 10% → 50% → 100% of users
3. **Monitoring**: Track error rates, performance metrics
4. **Rollback Plan**: Feature flag disable for instant revert

### Monitoring Setup
- Cloudflare Analytics for request patterns
- Custom metrics for ceremony success rates
- Error tracking and alerting
- Performance dashboards

## Phase 5: Cleanup & Optimization (Week 10)

### Legacy Code Removal
- Delete WebSocket implementation
- Remove feature flag infrastructure  
- Clean up unused dependencies
- Update documentation

### Performance Optimization
- Identify bottlenecks from production metrics
- Consider WebSocket upgrade for high-frequency use
- Implement result caching where appropriate
- Optimize WASM bundle size

## Risk Mitigation Strategies

### Technical Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| WASM performance issues | High | Early benchmarking, async optimization |
| DO storage limits | Medium | Multi-key pattern, size monitoring |
| Cold start latency | Low | Acceptable for ceremony initiation |

### Security Risks  
| Risk | Impact | Mitigation |
|------|--------|------------|
| Memory key exposure | High | Minimize exposure time, use zeroize |
| Ceremony hijacking | Medium | Unguessable operation_ids |
| DoS via crypto ops | Medium | Rate limiting, request validation |

### Migration Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Regression in functionality | High | Characterization tests |
| User experience degradation | Medium | Feature flag rollback |
| Data corruption | High | Atomic storage operations |

## Success Criteria

### Functional Requirements
- [ ] All existing FROST ceremony types work correctly
- [ ] Performance matches or exceeds current implementation  
- [ ] Zero data loss during migration
- [ ] Backwards compatibility during transition period

### Security Requirements  
- [ ] All cryptographic operations use constant-time implementations
- [ ] JWT authentication properly implemented with refresh tokens
- [ ] Rate limiting prevents DoS attacks
- [ ] Input validation prevents injection attacks

### Operational Requirements
- [ ] Comprehensive monitoring and alerting in place
- [ ] Rollback capability tested and verified
- [ ] Documentation updated for new architecture
- [ ] Team trained on new system operations

## Dependencies & Prerequisites

### External Dependencies
- `zcash/frost-core` Rust crate
- `jose` JWT library for TypeScript
- `miniflare` for local testing
- `vitest` for test framework

### Infrastructure Requirements
- Cloudflare Workers Paid Plan (for Durable Objects)
- D1 database for user data
- KV namespace for session storage (if needed)
- Worker Secrets for JWT signing keys

### Team Requirements
- Rust/WASM development experience
- Cloudflare Workers platform knowledge
- FROST protocol understanding
- Security best practices familiarity

## Timeline Summary

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| Phase 0 | 2 weeks | WASM module, characterization tests |
| Phase 1 | 2 weeks | HTTP API, JWT auth, DO scaffolding |
| Phase 2 | 2 weeks | WASM integration, security hardening |
| Phase 3 | 1 week | Comprehensive testing, benchmarking |
| Phase 4 | 2 weeks | Migration rollout, monitoring |
| Phase 5 | 1 week | Cleanup, optimization |

**Total Duration: 10 weeks**

## Next Steps

1. **Week 1**: Begin Phase 0 work immediately
2. **Stakeholder Review**: Present plan to team for approval
3. **Resource Allocation**: Assign developers to workstreams
4. **Risk Assessment**: Weekly risk review meetings
5. **Progress Tracking**: GitHub project board with phase milestones