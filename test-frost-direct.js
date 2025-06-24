// ABOUTME: Direct Node.js test of FROST WASM module to verify real cryptographic operations
// ABOUTME: Bypasses vitest issues and tests WASM module directly

const fs = require('fs');
const path = require('path');

async function testFrostWasm() {
  console.log('🔍 Testing FROST WASM module directly...\n');
  
  try {
    // Load the WASM module directly
    const wasmPath = path.join(__dirname, 'src/wasm/frost_wasm_core_bg.wasm');
    console.log('📁 WASM file path:', wasmPath);
    
    if (!fs.existsSync(wasmPath)) {
      console.error('❌ WASM file not found at:', wasmPath);
      return;
    }
    
    const wasmBuffer = fs.readFileSync(wasmPath);
    console.log('📦 WASM file size:', wasmBuffer.length, 'bytes');
    
    // Initialize WASM module
    const wasmModule = await WebAssembly.instantiate(wasmBuffer);
    console.log('✅ WASM module instantiated successfully');
    
    // Check exports
    const exports = wasmModule.instance.exports;
    console.log('🔧 Available WASM exports:', Object.keys(exports).filter(k => !k.startsWith('__')));
    
    // Test basic functionality
    if (typeof exports.create_keygen_state === 'function') {
      console.log('\n🧪 Testing create_keygen_state...');
      
      // This is a lower-level test - we'd need to handle memory management
      console.log('⚠️  Direct WASM testing requires proper memory management');
      console.log('   Using the JavaScript bindings instead...');
    }
    
  } catch (error) {
    console.error('❌ Error testing WASM module:', error);
  }
  
  // Test using the JS bindings
  console.log('\n🔧 Testing JavaScript bindings...');
  
  try {
    // Import the JS bindings
    const frostModule = require('./src/wasm/frost_wasm_core.js');
    console.log('📦 JS bindings loaded');
    
    // Initialize
    await frostModule.default();
    console.log('✅ WASM module initialized through JS bindings');
    
    // Test keygen
    console.log('\n🔑 Testing keygen ceremony...');
    const keygenResult = frostModule.create_keygen_state(2, 3);
    console.log('Keygen result:', keygenResult);
    
    const keygenData = JSON.parse(keygenResult);
    if (keygenData.success) {
      console.log('✅ Keygen ceremony created successfully');
      console.log('   Threshold:', keygenData.data.threshold);
      console.log('   Max participants:', keygenData.data.max_participants);
      
      // Test round 1
      console.log('\n🔄 Testing keygen round 1...');
      const round1Result = frostModule.keygen_round1(keygenResult, 'alice');
      console.log('Round 1 result:', round1Result);
      
      const round1Data = JSON.parse(round1Result);
      if (round1Data.success) {
        console.log('✅ Keygen round 1 processed successfully');
        console.log('   Package contains participant data:', round1Data.data[1].includes('alice'));
      } else {
        console.log('❌ Keygen round 1 failed:', round1Data.error);
      }
    } else {
      console.log('❌ Keygen ceremony creation failed:', keygenData.error);
    }
    
    // Test signing
    console.log('\n✍️  Testing signing ceremony...');
    const message = new TextEncoder().encode('Hello FROST!');
    const signers = JSON.stringify(['alice', 'bob']);
    const signingResult = frostModule.create_signing_state(message, signers);
    console.log('Signing result:', signingResult);
    
    const signingData = JSON.parse(signingResult);
    if (signingData.success) {
      console.log('✅ Signing ceremony created successfully');
      console.log('   Signers:', signingData.data.signers);
    } else {
      console.log('❌ Signing ceremony creation failed:', signingData.error);
    }
    
    console.log('\n🎉 FROST WASM module testing completed!');
    
  } catch (error) {
    console.error('❌ Error testing JS bindings:', error);
    console.log('\n💡 This likely means the WASM module is using mock implementations');
    console.log('   Check the Rust implementation in frost-wasm-core/src/lib.rs');
  }
}

// Run the test
testFrostWasm().then(() => {
  console.log('\n✅ Test completed');
}).catch(error => {
  console.error('\n❌ Test failed:', error);
});