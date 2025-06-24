# Manual Characterization Test Guide

## Purpose
This document provides manual test cases to validate the current WebSocket NIP-46 implementation before migration. These tests should be run against the current system to establish a baseline.

## Setup
1. Start the development server: `wrangler dev`
2. Open the web console at the provided URL
3. Open browser developer tools for WebSocket testing

## Test Cases

### 1. Basic Protocol Compliance

#### Test 1.1: WebSocket Connection
```javascript
// In browser console:
const ws = new WebSocket('ws://localhost:8787');
ws.onopen = () => console.log('Connected');
ws.onerror = (e) => console.error('Error:', e);
ws.onmessage = (e) => console.log('Response:', e.data);
```
**Expected**: Connection established successfully

#### Test 1.2: Describe Method  
```javascript
ws.send(JSON.stringify({
  id: "test-1",
  method: "describe", 
  params: []
}));
```
**Expected**: Response with supported methods array

#### Test 1.3: Invalid JSON
```javascript
ws.send('invalid json');
```
**Expected**: Error response about invalid JSON

### 2. Authentication Flow

#### Test 2.1: User Registration
```javascript
const username = `test-user-${Date.now()}`;
const password = 'test-password-123';

ws.send(JSON.stringify({
  id: "reg-1",
  method: "register",
  params: [username, password]
}));
```
**Expected**: `{"id":"reg-1","result":"ok"}`

#### Test 2.2: Duplicate Registration
```javascript
// Use same username as above
ws.send(JSON.stringify({
  id: "reg-2", 
  method: "register",
  params: [username, password]
}));
```
**Expected**: Error about username already existing

#### Test 2.3: Authentication
```javascript
ws.send(JSON.stringify({
  id: "conn-1",
  method: "connect",
  params: [username, password]
}));
```
**Expected**: `{"id":"conn-1","result":"ack"}`

#### Test 2.4: Invalid Credentials
```javascript
ws.send(JSON.stringify({
  id: "conn-2",
  method: "connect", 
  params: [username, "wrong-password"]
}));
```
**Expected**: Error about invalid credentials

### 3. Key Management

#### Test 3.1: Unauthenticated Key Access
```javascript
// Without calling connect first
ws.send(JSON.stringify({
  id: "pk-1",
  method: "get_public_key",
  params: []
}));
```
**Expected**: Error about not being authenticated

#### Test 3.2: Key Import
```javascript
// After successful authentication
const privateKey = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

ws.send(JSON.stringify({
  id: "import-1",
  method: "import_key",
  params: [privateKey, password]
}));
```
**Expected**: `{"id":"import-1","result":"ok"}`

#### Test 3.3: Public Key Retrieval
```javascript
ws.send(JSON.stringify({
  id: "pk-2", 
  method: "get_public_key",
  params: []
}));
```
**Expected**: 64-character hex public key string

### 4. Signing Flow

#### Test 4.1: Message Signing
```javascript
const message = "Hello, world!";

ws.send(JSON.stringify({
  id: "sign-1",
  method: "sign_event", 
  params: [message, password]
}));
```
**Expected**: 128-character hex signature string

#### Test 4.2: Wrong Password for Signing
```javascript
ws.send(JSON.stringify({
  id: "sign-2",
  method: "sign_event",
  params: [message, "wrong-password"]  
}));
```
**Expected**: Decryption or authentication error

### 5. Error Handling

#### Test 5.1: Unsupported Method
```javascript
ws.send(JSON.stringify({
  id: "unsup-1",
  method: "unsupported_method",
  params: []
}));
```
**Expected**: "Unsupported method" error

#### Test 5.2: Missing Parameters
```javascript
ws.send(JSON.stringify({
  id: "missing-1", 
  method: "register",
  params: [""] // Missing password
}));
```
**Expected**: Error about required parameters

### 6. Performance Baseline

#### Test 6.1: Response Time
```javascript
const start = Date.now();
ws.send(JSON.stringify({
  id: "perf-1",
  method: "describe",
  params: []
}));
// Measure time to response in onmessage handler
```
**Expected**: Response within 1 second

#### Test 6.2: Sequential Requests
```javascript
for (let i = 0; i < 5; i++) {
  ws.send(JSON.stringify({
    id: `seq-${i}`,
    method: "describe", 
    params: []
  }));
}
```
**Expected**: All requests receive responses

## Validation Checklist

- [ ] WebSocket connection establishes successfully
- [ ] Describe method returns correct method list
- [ ] User registration works for new users
- [ ] Duplicate registration is rejected
- [ ] Authentication works with correct credentials
- [ ] Authentication fails with incorrect credentials  
- [ ] Protected methods require authentication
- [ ] Key import generates and stores encrypted shares
- [ ] Public key retrieval works after import
- [ ] Message signing produces valid signatures
- [ ] Wrong password for signing is rejected
- [ ] Unsupported methods return appropriate errors
- [ ] Missing parameters are handled gracefully
- [ ] Response times are reasonable (< 1 second)
- [ ] Sequential requests are handled correctly

## Current Behavior Notes

The current implementation:
- Uses fake MuSig2 (not real FROST) 
- Stores encrypted shares in D1 database
- Uses PBKDF2 for password hashing
- Uses AES-GCM for share encryption
- Maintains WebSocket authentication state in memory
- Does not implement actual threshold signatures

This baseline will be used to ensure the new Durable Objects + HTTP API implementation maintains functional equivalence while adding real FROST cryptography.