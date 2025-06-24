#!/bin/bash

# HSM Lifecycle Management for Cost-Effective Testing
# Usage: ./hsm-lifecycle.sh [start|stop|status|test]

set -e

HSM_CLUSTER_NAME="frost-test-cluster"
REGION="us-west-2"  # Oregon - typically has good HSM availability

# Load VPC configuration
if [ -f .hsm-vpc-config ]; then
  source .hsm-vpc-config
  SUBNET_IDS="$SUBNET1_ID,$SUBNET2_ID"
else
  echo "❌ VPC configuration not found. Run './scripts/setup-vpc-for-hsm.sh' first"
  exit 1
fi

case "$1" in
  start)
    echo "🚀 Starting AWS CloudHSM cluster..."
    echo "💰 Cost: $1.45/hour starting now"
    
    # Create cluster with better error handling
    echo "Attempting to create CloudHSM cluster..."
    
    # Try creating cluster and capture any errors
    CLUSTER_OUTPUT=$(aws cloudhsmv2 create-cluster \
      --hsm-type hsm1.medium \
      --subnet-ids ${SUBNET_IDS//,/ } \
      --region $REGION \
      --output json 2>&1)
    
    # Check if creation was successful
    if [ $? -ne 0 ]; then
      echo "❌ Failed to create cluster with hsm1.medium"
      echo "Error: $CLUSTER_OUTPUT"
      
      # If it's an HSM type error, try the newer type
      if echo "$CLUSTER_OUTPUT" | grep -q "HsmType\|required argument"; then
        echo ""
        echo "Trying hsm2m.medium with FIPS mode..."
        CLUSTER_OUTPUT=$(aws cloudhsmv2 create-cluster \
          --hsm-type hsm2m.medium \
          --mode FIPS \
          --subnet-ids ${SUBNET_IDS//,/ } \
          --region $REGION \
          --output json 2>&1)
        
        if [ $? -ne 0 ]; then
          echo "❌ Failed to create cluster"
          echo "Error: $CLUSTER_OUTPUT"
          echo ""
          echo "Possible issues:"
          echo "1. CloudHSM might not be available in your AWS account"
          echo "2. Account limits for new AWS accounts"
          echo "3. Try contacting AWS Support to enable CloudHSM"
          exit 1
        fi
      else
        exit 1
      fi
    fi
    
    echo "✅ Cluster creation initiated"
    
    CLUSTER_ID=$(echo $CLUSTER_OUTPUT | jq -r '.Cluster.ClusterId')
    echo "Cluster ID: $CLUSTER_ID"
    
    # Save cluster ID for later operations
    echo $CLUSTER_ID > .hsm-cluster-id
    
    echo "⏳ Waiting for cluster to become active (this takes ~15 minutes)..."
    aws cloudhsmv2 wait cluster-active --cluster-id $CLUSTER_ID --region $REGION
    
    echo "✅ HSM cluster is active and ready!"
    echo "💡 Remember to run './hsm-lifecycle.sh stop' when done testing"
    ;;
    
  stop)
    if [ ! -f .hsm-cluster-id ]; then
      echo "❌ No active cluster found"
      exit 1
    fi
    
    CLUSTER_ID=$(cat .hsm-cluster-id)
    echo "🛑 Stopping AWS CloudHSM cluster: $CLUSTER_ID"
    echo "💰 Billing will stop in ~5 minutes"
    
    # Delete cluster
    aws cloudhsmv2 delete-cluster \
      --cluster-id $CLUSTER_ID \
      --region $REGION
    
    # Clean up
    rm -f .hsm-cluster-id
    
    echo "✅ HSM cluster deletion initiated"
    echo "💵 No more hourly charges after deletion completes"
    ;;
    
  status)
    if [ ! -f .hsm-cluster-id ]; then
      echo "📴 No active HSM cluster"
      exit 0
    fi
    
    CLUSTER_ID=$(cat .hsm-cluster-id)
    echo "📊 Checking cluster status: $CLUSTER_ID"
    
    STATUS=$(aws cloudhsmv2 describe-clusters \
      --filters clusterIds=$CLUSTER_ID \
      --region $REGION \
      --query 'Clusters[0].State' \
      --output text)
    
    echo "Status: $STATUS"
    
    if [ "$STATUS" = "ACTIVE" ]; then
      # Calculate running time and cost
      CREATED=$(aws cloudhsmv2 describe-clusters \
        --filters clusterIds=$CLUSTER_ID \
        --region $REGION \
        --query 'Clusters[0].CreateTimestamp' \
        --output text)
      
      echo "🟢 HSM is active and billing"
      echo "💰 Estimated cost so far: calculate based on start time"
    fi
    ;;
    
  test)
    if [ ! -f .hsm-cluster-id ]; then
      echo "❌ No active cluster. Run './hsm-lifecycle.sh start' first"
      exit 1
    fi
    
    CLUSTER_ID=$(cat .hsm-cluster-id)
    echo "🧪 Running FROST tests on cluster: $CLUSTER_ID"
    
    # Export for test script
    export AWS_CLOUDHSM_CLUSTER_ID=$CLUSTER_ID
    
    echo "1. Basic HSM test..."
    node test-hsm.mjs
    
    echo ""
    echo "2. Many users scenario test..."
    node test-hsm-many-users.mjs
    ;;
    
  auto-stop)
    echo "⏰ Setting up auto-stop in 2 hours..."
    
    # Schedule automatic shutdown in 2 hours
    # macOS date command syntax
    STOP_TIME=$(date -v+2H '+%Y-%m-%d %H:%M:%S')
    echo "Will auto-stop at: $STOP_TIME"
    
    # Create a simple cron job for auto-stop
    echo "#!/bin/bash
cd $(pwd)
./scripts/hsm-lifecycle.sh stop" > /tmp/hsm-auto-stop.sh
    chmod +x /tmp/hsm-auto-stop.sh
    
    # Use macOS's launchd or a simple background job
    (sleep 7200 && /tmp/hsm-auto-stop.sh) &
    echo "PID of auto-stop job: $!"
    echo "✅ Auto-stop scheduled"
    ;;
    
  cost)
    if [ ! -f .hsm-cluster-id ]; then
      echo "📴 No active cluster"
      exit 0
    fi
    
    echo "💰 Current AWS CloudHSM Costs:"
    echo "   Hourly rate: $1.45"
    echo "   Daily rate: $34.80"
    echo "   Monthly rate: $1,044"
    echo ""
    echo "💡 Cost-saving tips:"
    echo "   - Turn off when not testing: './hsm-lifecycle.sh stop'"
    echo "   - Use auto-stop: './hsm-lifecycle.sh auto-stop'"
    echo "   - Test in short bursts (1-2 hours)"
    ;;
    
  *)
    echo "Usage: $0 {start|stop|status|test|auto-stop|cost}"
    echo ""
    echo "Commands:"
    echo "  start     - Create and start HSM cluster ($1.45/hour)"
    echo "  stop      - Delete HSM cluster (stops billing)"
    echo "  status    - Check cluster status and cost"
    echo "  test      - Run FROST tests on active cluster"
    echo "  auto-stop - Schedule automatic shutdown in 2 hours"
    echo "  cost      - Show cost information"
    echo ""
    echo "Typical workflow:"
    echo "  1. ./hsm-lifecycle.sh start     # Start cluster"
    echo "  2. ./hsm-lifecycle.sh auto-stop # Schedule auto-shutdown"
    echo "  3. ./hsm-lifecycle.sh test      # Run tests"
    echo "  4. ./hsm-lifecycle.sh stop      # Manual stop if needed"
    exit 1
    ;;
esac