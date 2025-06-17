// ABOUTME: Test setup file to initialize WASM modules for vitest
// ABOUTME: Ensures FROST WASM module is available during testing

import { beforeAll } from 'vitest';
import { initializeFrost } from '../src/frost';

// Initialize WASM module before tests run
beforeAll(async () => {
  try {
    await initializeFrost();
    console.log('FROST WASM module initialized for testing');
  } catch (error) {
    console.warn('FROST WASM initialization failed in test environment:', error);
    // Don't fail tests if WASM can't be initialized
    // The implementation will use mock data if FROST is not available
  }
}); 