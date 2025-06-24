#!/bin/bash

# Initialize CloudHSM cluster for testing
# This uses a self-signed certificate which is suitable for testing only

CLUSTER_ID="cluster-c4hwhtqaj6b"
REGION="us-west-2"

echo "🔐 Initializing CloudHSM cluster..."

# Get the cluster CSR
echo "Getting cluster CSR..."
CSR=$(aws cloudhsmv2 describe-clusters \
  --filters clusterIds=$CLUSTER_ID \
  --region $REGION \
  --query 'Clusters[0].Certificates.ClusterCsr' \
  --output text)

# For testing, we'll use the AWS-provided certificate
# In production, you would sign the CSR with your own CA
echo "Using AWS-provided certificate for testing..."

# Get the HSM certificate
HSM_CERT=$(aws cloudhsmv2 describe-clusters \
  --filters clusterIds=$CLUSTER_ID \
  --region $REGION \
  --query 'Clusters[0].Certificates.HsmCertificate' \
  --output text)

# Get the AWS hardware certificate (trust anchor)
TRUST_ANCHOR=$(aws cloudhsmv2 describe-clusters \
  --filters clusterIds=$CLUSTER_ID \
  --region $REGION \
  --query 'Clusters[0].Certificates.AwsHardwareCertificate' \
  --output text)

# Save certificates to temp files
echo "$HSM_CERT" > /tmp/hsm-cert.pem
echo "$TRUST_ANCHOR" > /tmp/trust-anchor.pem

echo "Initializing cluster..."
aws cloudhsmv2 initialize-cluster \
  --cluster-id $CLUSTER_ID \
  --signed-cert file:///tmp/hsm-cert.pem \
  --trust-anchor file:///tmp/trust-anchor.pem \
  --region $REGION

if [ $? -eq 0 ]; then
  echo "✅ Cluster initialization started!"
  echo ""
  echo "The cluster will transition to INITIALIZED state."
  echo "This typically takes 5-10 minutes."
  echo ""
  echo "Monitor with: ./scripts/hsm-lifecycle.sh status"
else
  echo "❌ Initialization failed"
  echo ""
  echo "For testing, you may be able to use the cluster without full initialization."
  echo "The AWS SDK can sometimes handle this automatically."
fi

# Clean up temp files
rm -f /tmp/hsm-cert.pem /tmp/trust-anchor.pem