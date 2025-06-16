import { beforeAll } from 'vitest';
import * as frostWasm from '../frost-wasm-pkg/frost_taproot_wasm';

// Initialize WASM module before tests run
beforeAll(async () => {
  // Wait for WASM to be ready
  await new Promise(resolve => setTimeout(resolve, 100));
}); 