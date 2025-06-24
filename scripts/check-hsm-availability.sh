#!/bin/bash

echo "🔍 Checking AWS CloudHSM availability..."
echo ""

# Check current region
REGION=$(aws configure get region)
echo "Current region: $REGION"
echo ""

# Try different HSM types
echo "Testing HSM types..."
for HSM_TYPE in hsm2m.medium hsm1.medium; do
  echo -n "Trying $HSM_TYPE: "
  
  # Use dry-run to test without creating
  if aws cloudhsmv2 create-cluster \
    --hsm-type $HSM_TYPE \
    --subnet-ids subnet-02bc26bdbc350c19b subnet-0b6907c7b51692328 \
    --region $REGION \
    --dry-run 2>&1 | grep -q "would have succeeded"; then
    echo "✅ Available"
  else
    echo "❌ Not available"
  fi
done

echo ""
echo "🌎 CloudHSM Regional Availability:"
echo "CloudHSM is available in these regions:"
echo "• us-east-1 (N. Virginia)"
echo "• us-east-2 (Ohio)"
echo "• us-west-1 (N. California)"
echo "• us-west-2 (Oregon)"
echo "• eu-west-1 (Ireland)"
echo "• eu-central-1 (Frankfurt)"
echo "• ap-southeast-1 (Singapore)"
echo "• ap-northeast-1 (Tokyo)"
echo ""

# Check if service is enabled
echo "Checking if CloudHSM service is enabled..."
aws cloudhsmv2 describe-clusters --region $REGION >/dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "✅ CloudHSM service is accessible"
else
  echo "❌ CloudHSM service might not be enabled in your account"
fi