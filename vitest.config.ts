// vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // Point to the wrangler config file
        wrangler: { configPath: "./wrangler.jsonc" },
        // Optional: Configure miniflare options for the test environment
        miniflare: {
          // Example: Add a test-specific KV namespace
          // kvNamespaces: ["TEST_KV"],
          // Example: Mock outbound fetches
          // outboundService: (request) => new Response("Mock response"),
        },
      },
    },
    // Optional: Setup coverage reporting
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
    // Add WASM handling
    deps: {
      inline: [/frost-wasm-pkg/], // Inline WASM module
    },
    setupFiles: ['./test/setup.ts'], // Add setup file for WASM initialization
  },
}); 