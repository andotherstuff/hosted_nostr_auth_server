# Hardware Security Module (HSM) Integration Overview

## Executive Summary

NostrPassportServer implements hardware-backed cryptographic security through integration with Hardware Security Modules (HSMs). This ensures that all private keys are generated, stored, and used exclusively within certified secure hardware enclaves, providing the highest level of key protection available.

## Why HSMs for NostrPassportServer?

### The Challenge
Traditional software-based key management exposes private keys to numerous attack vectors:
- Memory dumps can reveal keys
- Malware can exfiltrate keys
- Compromised servers expose all user keys
- Side-channel attacks can extract keys

### The HSM Solution
HSMs provide hardware-isolated secure enclaves where:
- Keys are generated using true hardware random number generators
- Private keys never exist outside the HSM boundary
- All cryptographic operations occur within the secure enclave
- Physical tamper detection destroys keys if breached
- FIPS 140-2 Level 3 certification ensures security compliance

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     NostrPassportServer                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │   Worker     │───▶│ HSM Adapter  │───▶│  HSM Provider   │  │
│  │  (Stateless) │    │   Layer      │    │  (AWS/Azure/GCP)│  │
│  └─────────────┘    └──────────────┘    └─────────────────┘  │
│         │                                          │            │
│         ▼                                          ▼            │
│  ┌─────────────┐                          ┌─────────────────┐  │
│  │  Durable    │                          │  Hardware HSM   │  │
│  │  Objects    │                          │  Secure Enclave │  │
│  └─────────────┘                          └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Supported HSM Providers

### Production Providers

#### AWS CloudHSM
- **Type**: Network-attached HSM cluster
- **Certification**: FIPS 140-2 Level 3
- **Pricing**: $1.60/hour per HSM + network transfer
- **Best For**: AWS-native deployments with high throughput needs

#### Azure Dedicated HSM
- **Type**: Dedicated Thales Luna 7 devices
- **Certification**: FIPS 140-2 Level 3
- **Pricing**: ~$4,168/month per HSM
- **Best For**: Azure environments requiring dedicated hardware

#### Google Cloud HSM
- **Type**: Managed HSM service
- **Certification**: FIPS 140-2 Level 3
- **Pricing**: $2.58/hour for crypto operations
- **Best For**: GCP deployments with variable workloads

### Development Options

#### HSM Simulator
- **Purpose**: Cost-effective development and testing
- **Features**: Same API as production HSMs
- **Security**: Not suitable for production use
- **Cost**: Free

## Implementation Details

### Key Generation
```typescript
// All key generation happens within HSM
const keyShares = await hsm.generateFROSTKeyShares({
  threshold: 2,
  participants: 3,
  keyType: 'secp256k1'
});
// Returns only public key references, private shares never leave HSM
```

### Signing Operations
```typescript
// Signing request sent to HSM
const signature = await hsm.signWithThreshold({
  message: messageHash,
  keyId: 'hsm-key-123',
  shares: [share1, share2] // Share references, not actual keys
});
```

### Security Features

1. **Key Isolation**: Private keys exist only within HSM
2. **Access Control**: Role-based permissions for key operations
3. **Audit Logging**: All operations logged with tamper-proof timestamps
4. **Key Attestation**: Cryptographic proof of HSM-generated keys
5. **Backup/Recovery**: Secure key backup between HSMs only

## Development Workflow

### Phase 1: Local Development
- Use HSM simulator for all development
- Full API compatibility with production HSMs
- Zero infrastructure costs

### Phase 2: Integration Testing
- Deploy to staging with real HSM
- Use development HSM instance ($1-2/hour)
- Test all cryptographic operations

### Phase 3: Production Deployment
- Multi-HSM cluster for high availability
- Geographic distribution for disaster recovery
- 24/7 monitoring and alerting

## Cost Optimization Strategy

Given NostrPassportServer's usage pattern (many users, infrequent operations):

1. **Shared HSM Pool**: Multiple applications share HSM costs
2. **Operation Batching**: Group signatures to minimize HSM calls
3. **Caching Strategy**: Cache public keys and non-sensitive data
4. **Regional Deployment**: Use HSMs in lowest-cost regions

## Security Compliance

### Certifications
- FIPS 140-2 Level 3 hardware
- Common Criteria EAL4+ evaluation
- PCI-DSS compliance ready
- SOC 2 Type II compatible

### Best Practices
1. Regular key rotation (automated)
2. Multi-party key ceremonies for admin operations
3. Continuous security monitoring
4. Incident response procedures

## Migration Path

### From Software Keys to HSM
1. Generate new HSM-backed keys
2. Implement key migration ceremony
3. Gradual rollout with fallback
4. Deprecate software keys

### Between HSM Providers
- Provider-agnostic adapter layer
- Support concurrent multi-provider operation
- Zero-downtime migration capability

## Monitoring and Operations

### Key Metrics
- HSM availability and response time
- Operation throughput and latency
- Error rates and retry counts
- Cost per operation

### Alerts
- HSM connectivity issues
- High error rates
- Unusual usage patterns
- Certificate expiration warnings

## Future Enhancements

1. **Quantum-Resistant Algorithms**: Ready for post-quantum cryptography
2. **Multi-Party Computation**: Enhanced threshold schemes
3. **Confidential Computing**: Integration with CPU secure enclaves
4. **Decentralized HSM Network**: Distributed trust model

## Conclusion

Hardware Security Modules provide the foundation for NostrPassportServer's security architecture. By ensuring private keys never exist outside secure hardware boundaries, we deliver enterprise-grade security for the decentralized web.

For implementation details, see:
- [HSM Implementation Strategy](./IMPLEMENTATION_STRATEGY.md)
- [HSM Cost Comparison](./HSM_COST_COMPARISON.md)
- [HSM Scaling Strategy](./HSM_SCALING_STRATEGY.md)
- [HSM Testing Workflow](./HSM_TESTING_WORKFLOW.md)