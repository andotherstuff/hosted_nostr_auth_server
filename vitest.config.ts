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
          // Add test environment variables
          bindings: {
            JWT_ACCESS_SECRET: "test-access-secret-key-for-testing-only",
            JWT_REFRESH_SECRET: "test-refresh-secret-key-for-testing-only",
          },
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
    // Update to use new vitest config format
    server: {
      deps: {
        inline: [/frost-wasm-core/, /hono/], // Inline WASM module and hono
      },
    },
    setupFiles: ['./test/setup.ts'], // Add setup file for WASM initialization
  },
}); 