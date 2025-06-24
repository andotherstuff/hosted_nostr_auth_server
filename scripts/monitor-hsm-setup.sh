#!/bin/bash

echo "🔍 Monitoring HSM Setup Progress..."
echo ""

CLUSTER_ID="cluster-c4hwhtqaj6b"
REGION="us-west-2"
START_TIME=$(date +%s)

while true; do
  # Get current status
  STATUS=$(aws cloudhsmv2 describe-clusters \
    --filters clusterIds=$CLUSTER_ID \
    --region $REGION \
    --query 'Clusters[0].{ClusterState:State,HSMState:Hsms[0].State,HSMId:Hsms[0].HsmId}' \
    --output json)
  
  CLUSTER_STATE=$(echo $STATUS | jq -r '.ClusterState')
  HSM_STATE=$(echo $STATUS | jq -r '.HSMState')
  
  # Calculate elapsed time
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))
  ELAPSED_MIN=$((ELAPSED / 60))
  ELAPSED_SEC=$((ELAPSED % 60))
  
  # Clear line and print status
  printf "\r⏱️  Elapsed: %02d:%02d | Cluster: %-15s | HSM: %-20s" \
    $ELAPSED_MIN $ELAPSED_SEC "$CLUSTER_STATE" "$HSM_STATE"
  
  # Check if ready
  if [ "$CLUSTER_STATE" = "ACTIVE" ]; then
    echo ""
    echo ""
    echo "✅ CloudHSM is ACTIVE and ready!"
    echo ""
    echo "Run tests with: ./scripts/hsm-lifecycle.sh test"
    exit 0
  fi
  
  # Check for errors
  if [ "$CLUSTER_STATE" = "DEGRADED" ] || [ "$HSM_STATE" = "DEGRADED" ]; then
    echo ""
    echo "❌ HSM setup failed!"
    exit 1
  fi
  
  sleep 10
done