#!/usr/bin/env node

// Basic HSM connectivity test
import { CloudHSMV2Client, DescribeClustersCommand } from '@aws-sdk/client-cloudhsm-v2';

async function testBasicHSM() {
  console.log('🧪 Testing basic HSM connectivity...\n');
  
  const client = new CloudHSMV2Client({
    region: 'us-west-2'
  });
  
  try {
    // Get cluster info
    const command = new DescribeClustersCommand({
      Filters: {
        clusterIds: ['cluster-c4hwhtqaj6b']
      }
    });
    
    const response = await client.send(command);
    const clusters = response;
    
    const cluster = clusters.Clusters[0];
    console.log('📊 Cluster Info:');
    console.log(`   ID: ${cluster.ClusterId}`);
    console.log(`   State: ${cluster.State}`);
    console.log(`   HSM Type: ${cluster.HsmType}`);
    console.log(`   HSMs: ${cluster.Hsms.length}`);
    
    if (cluster.Hsms.length > 0) {
      const hsm = cluster.Hsms[0];
      console.log(`\n🔐 HSM Info:`);
      console.log(`   ID: ${hsm.HsmId}`);
      console.log(`   State: ${hsm.State}`);
      console.log(`   IP: ${hsm.EniIp || 'Not assigned yet'}`);
    }
    
    // Note: Actual cryptographic operations require the cluster to be ACTIVE
    // and you need to use the AWS CloudHSM SDK (not CloudHSMV2 API)
    
    if (cluster.State === 'UNINITIALIZED') {
      console.log('\n⚠️  Cluster is UNINITIALIZED');
      console.log('   Some operations may be limited.');
      console.log('   For full functionality, the cluster needs initialization.');
      console.log('\n💡 However, we can still test with simulated HSM mode!');
    }
    
    console.log('\n✅ Basic connectivity test passed!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testBasicHSM();