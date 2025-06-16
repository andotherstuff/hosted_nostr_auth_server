#!/bin/bash
# ABOUTME: Build script for FROST WASM core module
# ABOUTME: Compiles Rust to WASM and prepares for Worker integration

set -e

echo "🦀 Building FROST WASM core module..."

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "❌ wasm-pack not found. Installing..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

# Build the WASM module
echo "📦 Compiling Rust to WASM..."
wasm-pack build --target web --out-dir ../src/wasm --scope frost

# Clean up unnecessary files
echo "🧹 Cleaning up..."
rm -f ../src/wasm/.gitignore ../src/wasm/README.md

# Verify build
if [ -f "../src/wasm/frost_wasm_core_bg.wasm" ]; then
    echo "✅ WASM module built successfully"
    echo "📊 WASM bundle size: $(du -h ../src/wasm/frost_wasm_core_bg.wasm | cut -f1)"
else
    echo "❌ WASM build failed"
    exit 1
fi

echo "🎉 Build complete! WASM module available at src/wasm/"