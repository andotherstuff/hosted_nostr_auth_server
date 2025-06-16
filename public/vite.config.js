import { defineConfig } from 'vite';

export default defineConfig({
  // We don't need a complex config for now.
  // Vite will automatically pick up index.html as the entry point.
  build: {
    // Output directory relative to this config file (i.e., public/dist)
    outDir: 'dist',
    // Generate sourcemaps for debugging
    sourcemap: true,
  },
  // If running vite dev standalone, proxy API requests to the wrangler worker
  // server: {
  //   proxy: {
  //     '/connect': 'http://localhost:8787',
  //     '/sign': 'http://localhost:8787',
  //     '/push': 'http://localhost:8787',
  //   }
  // }
}); 