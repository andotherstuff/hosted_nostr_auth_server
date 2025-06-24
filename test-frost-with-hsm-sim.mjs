#!/usr/bin/env node

// Test FROST with simulated HSM (while real HSM is uninitialized)
import { HSMFrostAdapter } from './src/hsm/HSMAdapter.ts';

async function testFrostWithHSMSimulation() {
  console.log('🧪 Testing FROST with HSM Simulation Mode\n');
  console.log('📝 Note: Using simulated HSM while real HSM cluster is being initialized\n');

  try {
    // Create HSM adapter in simulated mode
    const hsmAdapter = new HSMFrostAdapter({
      hsmProvider: 'simulated',
      config: {
        simulateNetworkDelay: true,
        attestationEnabled: true
      }
    });

    console.log('1️⃣ Test: Key Generation with HSM Simulation');
    console.log('   Creating 3-of-5 threshold setup...');
    
    const participants = ['alice', 'bob', 'carol', 'dave', 'eve'];
    const threshold = 3;
    
    // Simulate key generation ceremony
    const keygenResult = await hsmAdapter.createKeygenCeremony(
      threshold,
      participants
    );
    
    if (keygenResult.success) {
      console.log('   ✅ Key generation successful!');
      console.log(`   🔑 Group public key: ${keygenResult.data.groupPublicKey.slice(0, 16)}...`);
      console.log(`   👥 ${participants.length} participants received shares`);
      
      // Check attestation
      if (keygenResult.data.attestation) {
        console.log('   🛡️  HSM Attestation:');
        console.log(`      - Provider: ${keygenResult.data.attestation.provider}`);
        console.log(`      - Mode: ${keygenResult.data.attestation.mode}`);
        console.log(`      - Timestamp: ${new Date(keygenResult.data.attestation.timestamp).toISOString()}`);
      }
    } else {
      console.log(`   ❌ Key generation failed: ${keygenResult.error}`);
      return;
    }
    
    console.log('\n2️⃣ Test: Signing with HSM Simulation');
    
    // Select signers (need exactly threshold number)
    const signers = participants.slice(0, threshold);
    console.log(`   👥 Signers: ${signers.join(', ')}`);
    
    const message = new TextEncoder().encode('Test FROST signature with HSM');
    console.log(`   📝 Message: "Test FROST signature with HSM"`);
    
    // Create signing ceremony
    const signingResult = await hsmAdapter.createSigningCeremony(
      `test-signing-${Date.now()}`,
      signers,
      keygenResult.data.keyShares.slice(0, threshold).map(ks => ks.identifier)
    );
    
    if (signingResult.success) {
      console.log('   ✅ Signing ceremony created');
      
      // Simulate completing the signing
      const signature = await hsmAdapter.completeSigningCeremony(
        signingResult.data.ceremonyId,
        message
      );
      
      if (signature.success) {
        console.log('   ✅ Signature generated!');
        console.log(`   📜 Signature: ${Buffer.from(signature.data.signature).toString('hex').slice(0, 32)}...`);
        
        if (signature.data.attestation) {
          console.log('   🛡️  Signing Attestation:');
          console.log(`      - Operation: ${signature.data.attestation.operation}`);
          console.log(`      - Security Level: ${signature.data.attestation.securityLevel}`);
        }
      }
    }
    
    console.log('\n3️⃣ Test: Performance Metrics');
    
    const perfStart = Date.now();
    const iterations = 10;
    
    for (let i = 0; i < iterations; i++) {
      await hsmAdapter.createKeygenCeremony(2, ['user1', 'server']);
    }
    
    const perfEnd = Date.now();
    const avgTime = (perfEnd - perfStart) / iterations;
    
    console.log(`   ⚡ Average key generation time: ${avgTime.toFixed(0)}ms`);
    console.log(`   📊 Simulated network delay: ${hsmAdapter.config.simulateNetworkDelay ? 'ON' : 'OFF'}`);
    
    console.log('\n✅ All HSM simulation tests completed!');
    console.log('\n💡 Next Steps:');
    console.log('   1. Initialize the real HSM cluster for production use');
    console.log('   2. Switch hsmProvider from "simulated" to "aws"');
    console.log('   3. Add proper PKI certificates for cluster initialization');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testFrostWithHSMSimulation();