#!/bin/bash

echo "🔍 Testing CloudHSM cluster creation directly..."

# Load VPC config
source .hsm-vpc-config

echo "Region: us-west-2"
echo "Subnets: $SUBNET1_ID, $SUBNET2_ID"
echo ""

# Test different HSM types with detailed output
echo "1. Testing hsm1.medium:"
aws cloudhsmv2 create-cluster \
  --hsm-type hsm1.medium \
  --subnet-ids $SUBNET1_ID $SUBNET2_ID \
  --region us-west-2 \
  --output json

echo ""
echo "2. Testing hsm2m.medium with FIPS mode:"
aws cloudhsmv2 create-cluster \
  --hsm-type hsm2m.medium \
  --mode FIPS \
  --subnet-ids $SUBNET1_ID $SUBNET2_ID \
  --region us-west-2 \
  --output json

echo ""
echo "3. Testing hsm2m.medium with NON_FIPS mode:"
aws cloudhsmv2 create-cluster \
  --hsm-type hsm2m.medium \
  --mode NON_FIPS \
  --subnet-ids $SUBNET1_ID $SUBNET2_ID \
  --region us-west-2 \
  --output json