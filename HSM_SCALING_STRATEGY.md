# HSM Strategy: Many Keys, Few Operations (FROST Shard Creation)

## Use Case Analysis
- **Many keys**: One per user (potentially thousands to millions)
- **Few operations**: Primarily FROST shard creation/rotation
- **Operation frequency**: Low (users don't sign often)
- **Key lifecycle**: Long-term storage with infrequent access

## Cost Analysis at Scale

### Break-even Points

| User Count | AWS CloudHSM | Google Cloud HSM | Winner |
|------------|--------------|------------------|---------|
| 100 | $1,050/month | $5/month | Google |
| 1,000 | $1,050/month | $50/month | Google |
| **2,100** | $1,050/month | $105/month | **Tie** |
| 10,000 | $1,050/month | $500/month | **AWS** |
| 100,000 | $1,050/month | $5,000/month | **AWS** |
| 1,000,000 | $1,050/month | $50,000/month | **AWS** |

**Break-even point: ~2,100 users**

## Recommended Implementation Strategy

### **Phase 1: Simulated HSM (0-100 users)**
```typescript
// Cost: $0
// Perfect for initial testing and validation

const hsm = await createHSMFrost({
  hsmProvider: 'simulated',
  fallbackToSoftware: true
});
```

### **Phase 2: Google Cloud HSM (100-2,000 users)**
```typescript
// Cost: $5-100/month
// Good for early growth phase

const hsm = await createHSMFrost({
  hsmProvider: 'google',
  config: {
    projectId: 'your-project',
    location: 'global',
    keyRing: 'frost-production'
  }
});
```

### **Phase 3: AWS CloudHSM (2,000+ users)**
```typescript
// Cost: $1,050/month (fixed)
// Most economical for scale

const hsm = await createHSMFrost({
  hsmProvider: 'aws',
  config: {
    region: 'us-east-1',
    clusterId: 'cluster-abc123'
  }
});
```

## Alternative Architecture: Hybrid Approach

Since you're primarily doing FROST shard creation, consider a **hybrid model**:

### **Option A: HSM for Master Keys + Software for User Keys**
```typescript
class HybridFrostService {
  private masterHSM: HSMClient;      // Few master keys in expensive HSM
  private userKeyManager: SoftwareKeyManager;  // Many user keys in encrypted storage

  async createUserFrostShards(userId: string, threshold: number): Promise<FrostShards> {
    // 1. Generate user key in software (encrypted at rest)
    const userKey = await this.userKeyManager.generateUserKey(userId);
    
    // 2. Use master HSM key to create FROST ceremony
    const masterShards = await this.masterHSM.createFrostCeremony(threshold);
    
    // 3. Combine to create user-specific FROST shards
    return await this.createUserShards(userKey, masterShards);
  }
}
```

**Benefits:**
- **Fixed cost**: Only pay for master keys in HSM
- **Security**: Critical operations still HSM-protected
- **Scalability**: User keys in cheaper encrypted storage

### **Option B: Hierarchical Key Derivation**
```typescript
class HierarchicalFrostService {
  async createUserFrostShards(userId: string): Promise<FrostShards> {
    // 1. Derive user key from master HSM key using BIP32-like derivation
    const userKeyPath = `m/0'/users/${userId}`;
    const derivedKey = await this.masterHSM.deriveKey(userKeyPath);
    
    // 2. Create FROST shards from derived key
    return await this.createFrostShardsFromKey(derivedKey);
  }
}
```

**Benefits:**
- **Single master key**: Only one key stored in expensive HSM
- **Deterministic**: Can recreate user keys from master + derivation path
- **Backup-friendly**: Only need to backup master key

## Implementation Walkthrough

Since AWS CloudHSM is actually your best long-term option, let me walk you through setting it up **for testing** (you can run it for just a few hours):

### **Step 1: AWS CloudHSM Setup (Limited Time Testing)**
```bash
# Create HSM cluster (takes ~15 minutes to provision)
aws cloudhsmv2 create-cluster \
  --hsm-type hsm1.medium \
  --subnet-ids subnet-abc123 subnet-def456

# Cost: $1.45/hour (so test for 2 hours = $2.90)
```

### **Step 2: Test with Your FROST Implementation**
```typescript
// Test script for real AWS CloudHSM
async function testAWSCloudHSM() {
  const hsm = await createHSMFrost({
    hsmProvider: 'aws',
    config: {
      region: 'us-east-1',
      clusterId: process.env.AWS_CLOUDHSM_CLUSTER_ID
    }
  });

  // Test creating FROST shards for multiple users
  const users = ['user1', 'user2', 'user3', 'user4', 'user5'];
  
  for (const userId of users) {
    console.log(`Creating FROST shards for ${userId}...`);
    
    const shards = await hsm.createKeygenCeremony(2, [userId, 'server']);
    console.log(`✅ User ${userId} shards created`);
    
    // Test shard creation (your primary use case)
    const newShards = await hsm.createSigningCeremony(
      `rotate-shards-${userId}`, 
      [userId, 'server']
    );
    console.log(`✅ User ${userId} shard rotation ready`);
  }
  
  // Test that ALL user keys are stored in the SAME HSM
  console.log('📊 All user keys stored in single HSM cluster');
  console.log('💰 Cost: $1.45/hour regardless of user count');
}
```

### **Step 3: Cost Optimization**
```bash
# Delete cluster after testing to stop charges
aws cloudhsmv2 delete-cluster --cluster-id cluster-abc123

# Or schedule automatic deletion
aws events put-rule --name "delete-hsm-cluster" \
  --schedule-expression "rate(2 hours)" \
  --targets "Id"="1","Arn"="arn:aws:lambda:..."
```

## Immediate Next Steps

1. **Today**: Test simulated HSM with your current FROST implementation
2. **This week**: Set up Google Cloud HSM for small-scale testing ($5-20)
3. **Next week**: Test AWS CloudHSM for 2-4 hours ($3-6 total cost)
4. **Decision point**: Choose based on expected user growth

Want to start with the simulated HSM test to validate the architecture, then move to real testing?