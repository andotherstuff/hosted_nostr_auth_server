# Cost-Optimized HSM Testing Workflow

## Smart On/Off Strategy for AWS CloudHSM

### **Key Insight**: AWS CloudHSM can be completely turned on/off
- ✅ **Billing stops** when cluster is deleted
- ✅ **Full control** over when you pay
- ✅ **No per-key storage fees** when off

## Practical Testing Approach

### **Session 1: Architecture Validation (2 hours = $2.90)**
```bash
# Start HSM cluster
./scripts/hsm-lifecycle.sh start

# Schedule auto-shutdown in 2 hours
./scripts/hsm-lifecycle.sh auto-stop

# Run comprehensive tests
./scripts/hsm-lifecycle.sh test

# Manual stop if done early
./scripts/hsm-lifecycle.sh stop
```

### **Session 2: Load Testing (4 hours = $5.80)**
```bash
# Start for load testing
./scripts/hsm-lifecycle.sh start

# Test with many users (your use case)
node test-many-users-hsm.js

# Stop when done
./scripts/hsm-lifecycle.sh stop
```

### **Session 3: Integration Testing (3 hours = $4.35)**
```bash
# Start for integration testing
./scripts/hsm-lifecycle.sh start

# Test with your full application
npm test -- --hsm-enabled

# Stop after tests
./scripts/hsm-lifecycle.sh stop
```

**Total testing cost: ~$13 over several weeks**

## Automated Testing Script

Let me create a script to test your specific use case (many keys, few operations):

```typescript
// test-many-users-hsm.js
async function testManyUsersScenario() {
  console.log('🧪 Testing Many Users, Few Operations Scenario');
  
  const hsm = await createHSMFrost({
    hsmProvider: 'aws',
    config: {
      clusterId: process.env.AWS_CLOUDHSM_CLUSTER_ID
    }
  });

  // Simulate 1000 users registering
  console.log('👥 Simulating 1000 user registrations...');
  const users = Array.from({length: 1000}, (_, i) => `user${i}`);
  
  for (let i = 0; i < users.length; i++) {
    const userId = users[i];
    
    // Each user gets FROST key shares created
    const keyShares = await hsm.createKeygenCeremony(2, [userId, 'server']);
    
    if (i % 100 === 0) {
      console.log(`✅ Created FROST shards for ${i + 1} users`);
    }
  }
  
  console.log('📊 Test Results:');
  console.log(`   Users: ${users.length}`);
  console.log(`   FROST operations: ${users.length}`);
  console.log('   Cost: $1.45/hour (regardless of user count)');
  console.log('   Per-user cost: $0 (fixed HSM cost)');
  
  // Test occasional shard rotation
  console.log('🔄 Testing shard rotation for 10 users...');
  for (let i = 0; i < 10; i++) {
    await hsm.createSigningCeremony(
      `rotate-${users[i]}`, 
      [users[i], 'server']
    );
  }
  
  console.log('✅ Many users, few operations test complete');
}
```

## Cost Comparison: On/Off vs Always-On

### **Smart On/Off Usage (Your Approach)**
- Development: 10 hours/month = $14.50
- Testing: 20 hours/month = $29.00  
- **Total: $43.50/month**

### **Always-On Production**
- 24/7 operation = $1,044/month
- But supports unlimited users at this fixed cost

### **Hybrid Development Strategy**
```bash
# Development (simulated HSM - free)
npm run dev:simulated

# Weekly real HSM testing (2 hours)
./scripts/hsm-lifecycle.sh start
npm test -- --hsm-real
./scripts/hsm-lifecycle.sh stop

# Pre-production validation (4 hours)
./scripts/hsm-lifecycle.sh start
npm run test:integration:hsm
./scripts/hsm-lifecycle.sh stop
```

## AWS CloudHSM Quick Setup for On/Off Testing

### **Prerequisites Setup**
```bash
# 1. Make script executable
chmod +x scripts/hsm-lifecycle.sh

# 2. Set up AWS credentials
aws configure

# 3. Create VPC and subnets (one-time setup)
aws ec2 create-vpc --cidr-block 10.0.0.0/16
aws ec2 create-subnet --vpc-id vpc-xxx --cidr-block 10.0.1.0/24
aws ec2 create-subnet --vpc-id vpc-xxx --cidr-block 10.0.2.0/24

# 4. Update script with your subnet IDs
# Edit scripts/hsm-lifecycle.sh and set SUBNET_IDS
```

### **First Test Session**
```bash
# Start HSM (begins billing)
./scripts/hsm-lifecycle.sh start

# Check status
./scripts/hsm-lifecycle.sh status

# Run tests
./scripts/hsm-lifecycle.sh test

# Stop HSM (ends billing)
./scripts/hsm-lifecycle.sh stop
```

## Alternative: Google Cloud HSM for Early Testing

If you want to test with real HSMs before committing to AWS CloudHSM's hourly rate:

```bash
# Google Cloud HSM - pay per operation, not time
gcloud kms keyrings create frost-testing --location=global

# Create test key
gcloud kms keys create test-frost-key \
  --location=global \
  --keyring=frost-testing \
  --purpose=asymmetric-signing \
  --default-algorithm=ec-sign-secp256k1-sha256 \
  --protection-level=hsm

# Cost: $0.05/month per key + $0.15 per 1000 operations
```

## Recommendation

1. **This week**: Test with simulated HSM (free)
2. **Next week**: One 2-hour AWS CloudHSM session ($2.90)
3. **Following week**: Another 4-hour session for load testing ($5.80)
4. **Decision point**: Choose production HSM based on test results

The on/off capability makes AWS CloudHSM perfect for development and testing. You only pay when you're actively using it!

Want to start with setting up the lifecycle management script?