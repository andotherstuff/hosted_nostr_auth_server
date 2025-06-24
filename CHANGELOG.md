# Changelog

All notable changes to the NostrPassportServer project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Hardware Security Module (HSM) / Secure Enclave integration for cryptographic key management
- AWS CloudHSM adapter implementation for production-grade key security
- HSM simulation mode for cost-effective development and testing
- Comprehensive HSM documentation including:
  - Cost comparison across multiple providers (AWS CloudHSM, Azure Dedicated HSM, Google Cloud HSM)
  - Scaling strategy optimized for many users with infrequent operations
  - Testing workflow to minimize costs during development
- Durable Objects implementation for distributed session management
- JWT-based authentication system with secure session handling
- Password hashing utilities using scrypt for enhanced security

### Changed
- Migrated from in-memory key storage to HSM-backed secure enclave architecture
- Refactored authentication flow to use stateless JWT tokens with Durable Objects
- Updated database schema to support HSM key references and session management
- Enhanced validation utilities for comprehensive input sanitization

### Security
- All cryptographic operations now performed within hardware secure enclaves
- Private keys never exposed to application memory
- Session tokens bound to specific HSM-protected keys
- Implemented defense-in-depth with multiple security layers

## [0.2.0] - 2024-01-15

### Added
- Secure stateless architecture with session-based authentication
- Hardware-ready architecture for HSM integration
- Comprehensive test suite for FROST operations
- Manual characterization tests for protocol validation

### Changed
- Refactored from stateful to stateless session management
- Improved error handling and validation throughout the codebase
- Enhanced database schema for better performance and security

## [0.1.0] - 2024-01-10

### Added
- Initial FROST (Flexible Round-Optimized Schnorr Threshold) implementation
- Basic Nostr authentication server functionality
- WebAssembly core for FROST cryptographic operations
- Cloudflare Workers deployment configuration
- D1 database integration for persistent storage
- Comprehensive README with NostrPassportServer branding
- Architecture documentation and implementation plan

### Security
- Implemented threshold signature scheme for distributed key management
- Added input validation for all API endpoints
- Secured database operations with parameterized queries

[Unreleased]: https://github.com/rabble/hosted_nostr_auth_server/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/rabble/hosted_nostr_auth_server/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rabble/hosted_nostr_auth_server/releases/tag/v0.1.0