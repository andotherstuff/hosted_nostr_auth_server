# NostrPassportServer

A secure, distributed Nostr authentication server implementing NIP-46 signing service with FROST (Flexible Round-Optimized Schnorr Threshold) signatures on Cloudflare Workers with Hardware Security Module (HSM) support.

## Overview

NostrPassportServer provides a production-ready signing service for Nostr clients using threshold cryptography with hardware-backed security. Built on Cloudflare's edge infrastructure, it offers secure key management through distributed FROST ceremonies while maintaining high availability and low latency. All cryptographic operations are performed within hardware secure enclaves, ensuring private keys never exist in application memory.

### Key Features

- **Hardware Security Module (HSM) Integration**: All cryptographic operations performed in secure enclaves
- **NIP-46 Compatible**: Full support for Nostr signing protocol
- **FROST Threshold Signatures**: Distributed key management using zcash/frost-core
- **Cloudflare Workers**: Edge deployment for global low-latency access
- **Durable Objects**: Stateful ceremony management with strong consistency
- **JWT Authentication**: Secure, stateless authentication with refresh tokens
- **HTTP-First API**: RESTful design with WebSocket upgrade capabilities
- **Multi-Provider Support**: Compatible with AWS CloudHSM, Azure Dedicated HSM, and Google Cloud HSM

## Architecture

The server uses a modern, distributed architecture with hardware security at its core:

- **Hardware Security Module (HSM)**: Secure enclave for all cryptographic operations
- **Main Worker**: Stateless router handling authentication and request forwarding
- **FrostCeremonyDO**: Stateful actors managing individual ceremony lifecycles
- **Frost WASM Core**: Pure Rust cryptographic implementation compiled to WebAssembly
- **HSM Adapter Layer**: Abstraction for multiple HSM providers (AWS, Azure, Google Cloud)

### Security Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Nostr Client   │────▶│ CloudFlare Edge │────▶│   HSM Secure    │
│                 │     │    (Stateless)   │     │    Enclave      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │                         │
                               ▼                         ▼
                        ┌─────────────────┐      ┌─────────────────┐
                        │ Durable Objects │      │ Cryptographic   │
                        │   (Sessions)    │      │   Operations    │
                        └─────────────────┘      └─────────────────┘
```

For detailed architecture information, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Cloudflare account with Workers enabled
- Wrangler CLI installed globally

### Installation

```bash
# Clone the repository
git clone https://github.com/andotherstuff/hosted_nostr_auth_server.git
cd hosted_nostr_auth_server

# Install dependencies
npm install

# Install worker dependencies
cd workers && npm install && cd ..

# Install frontend dependencies
cd public && npm install && cd ..
```

### Development

```bash
# Run tests
npm test

# Run tests with coverage
npm run coverage

# Start local development server
wrangler dev
```

### Deployment

```bash
# Deploy to Cloudflare Workers
wrangler deploy
```

## API Reference

### Authentication

#### Get Access Token
```http
POST /auth/token
Content-Type: application/json

{
  "username": "your_username",
  "password": "your_password"
}
```

#### Refresh Token
```http
POST /auth/refresh
Authorization: Bearer <refresh_token>
```

### FROST Ceremonies

#### Start New Ceremony
```http
POST /ceremony/start
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "threshold": 2,
  "participants": ["user1", "user2", "user3"]
}
```

#### Submit Round Data
```http
POST /ceremony/{operation_id}/round/{round_number}
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "participant_data": "..."
}
```

## Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Database configuration
DATABASE_URL=your_database_url

# JWT configuration
JWT_SECRET=your_jwt_secret
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d

# FROST configuration
FROST_THRESHOLD=2
MAX_PARTICIPANTS=10

# HSM configuration
HSM_PROVIDER=aws  # Options: aws, azure, google, simulator
HSM_CLUSTER_ID=your_cluster_id
HSM_REGION=us-west-2
HSM_SIMULATION_MODE=false  # Set to true for development
```

### HSM Configuration

#### AWS CloudHSM Setup

1. Create a CloudHSM cluster in your AWS account:
```bash
aws cloudhsmv2 create-cluster --hsm-type hsm1.medium --subnet-ids subnet-xxxxx
```

2. Initialize the cluster and create crypto user
3. Configure environment variables with cluster details

#### Development Mode (HSM Simulator)

For cost-effective development, use the HSM simulator:

```env
HSM_SIMULATION_MODE=true
```

This provides the same API interface without actual hardware costs.

### Wrangler Configuration

Configure your `wrangler.toml`:

```toml
name = "nostrpassportserver"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[env.production]
vars = { ENVIRONMENT = "production" }

[[env.production.d1_databases]]
binding = "DB"
database_name = "nostrpassportserver-prod"
database_id = "your-database-id"
```

## Development

### Project Structure

```
├── src/                    # Main application source
│   ├── db/                # Database schema and utilities
│   ├── frost.ts           # FROST cryptographic operations
│   └── index.ts           # Main worker entry point
├── workers/               # Cloudflare Workers configuration
├── public/                # Frontend assets
├── test/                  # Test suites
├── migrations/            # Database migrations
└── frost-wasm-core/       # Rust WASM cryptographic core
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run coverage

# Run specific test file
npx vitest test/index.spec.ts
```

### Building WASM Module

```bash
cd frost-wasm-core
./build.sh
```

## Security

### Hardware Security Module (HSM) Protection

- **Secure Enclaves**: All private keys are generated and stored within FIPS 140-2 Level 3 certified HSMs
- **Key Isolation**: Private keys never exist in application memory or on disk
- **Hardware-Backed Operations**: All cryptographic signing occurs within the HSM boundary
- **Multi-Provider Support**: Abstraction layer supports AWS CloudHSM, Azure Dedicated HSM, and Google Cloud HSM
- **Key Attestation**: Cryptographic proof that keys were generated within the HSM

### Cryptographic Security

- **Constant-time operations**: All cryptographic operations use side-channel resistant implementations
- **Secret zeroization**: Memory is properly cleared using the `zeroize` crate
- **HKDF key derivation**: Separate password hashing from encryption key derivation
- **Scrypt password hashing**: Memory-hard function resistant to GPU/ASIC attacks
- **FROST Threshold Signatures**: k-of-n threshold scheme where k parties must cooperate to sign

### Transport Security

- **Unguessable operation IDs**: Using `crypto.randomUUID()` for ceremony identifiers
- **Participant authorization**: JWT validation ensures users can only access their ceremonies
- **Rate limiting**: Protection against DoS attacks on CPU-intensive operations
- **Idempotent operations**: Safe request retry without state corruption
- **TLS Everywhere**: All communication encrypted in transit

### Defense in Depth

Multiple security layers ensure comprehensive protection:

1. **Network Layer**: CloudFlare DDoS protection and Web Application Firewall
2. **Application Layer**: Input validation, rate limiting, and secure session management
3. **Cryptographic Layer**: HSM-backed key operations with threshold signatures
4. **Data Layer**: Encrypted at rest with customer-managed keys

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Add tests for new functionality
- Update documentation as needed
- Ensure all tests pass before submitting PR

## Documentation

### Core Documentation
- [Architecture Overview](./ARCHITECTURE.md) - Detailed system architecture
- [Implementation Plan](./IMPLEMENTATION_PLAN.md) - Development roadmap
- [Project Roadmap](./PROJECT_ROADMAP.md) - Long-term project goals
- [Changelog](./CHANGELOG.md) - Version history and recent changes

### HSM Documentation
- [HSM Implementation Strategy](./IMPLEMENTATION_STRATEGY.md) - Secure enclave development approach
- [HSM Cost Comparison](./HSM_COST_COMPARISON.md) - Provider pricing analysis
- [HSM Scaling Strategy](./HSM_SCALING_STRATEGY.md) - Optimized for many users, few operations
- [HSM Testing Workflow](./HSM_TESTING_WORKFLOW.md) - Cost-effective development practices

### Development Resources
- [GitHub Issues](./GITHUB_ISSUES.md) - Known issues and feature requests
- [API Documentation](./docs/api.md) - Complete API reference
- [Security Best Practices](./docs/security.md) - Security implementation guide

## License

This project is licensed under the ISC License - see the LICENSE file for details.

## Support

For questions, issues, or contributions:

- Open an issue on GitHub
- Check existing documentation in the `/docs` folder
- Review the [project roadmap](./PROJECT_ROADMAP.md) for planned features

## Acknowledgments

- Built with [zcash/frost-core](https://github.com/ZcashFoundation/frost) for threshold cryptography
- Powered by [Cloudflare Workers](https://workers.cloudflare.com/) for edge computing
- Implements [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) Nostr signing protocol
