#!/bin/bash

# One-time VPC setup for AWS CloudHSM
# This creates the network infrastructure needed for HSM

set -e

echo "🌐 Setting up VPC for AWS CloudHSM..."

# Set region
REGION="us-west-2"
echo "Using region: $REGION"

# Create VPC
VPC_OUTPUT=$(aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --region $REGION \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=hsm-test-vpc}]' \
  --output json)

VPC_ID=$(echo $VPC_OUTPUT | jq -r '.Vpc.VpcId')
echo "✅ Created VPC: $VPC_ID"

# Enable DNS hostnames
aws ec2 modify-vpc-attribute \
  --vpc-id $VPC_ID \
  --enable-dns-hostnames \
  --region $REGION

# Create Internet Gateway
IGW_OUTPUT=$(aws ec2 create-internet-gateway \
  --region $REGION \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=hsm-test-igw}]' \
  --output json)

IGW_ID=$(echo $IGW_OUTPUT | jq -r '.InternetGateway.InternetGatewayId')
echo "✅ Created Internet Gateway: $IGW_ID"

# Attach Internet Gateway to VPC
aws ec2 attach-internet-gateway \
  --vpc-id $VPC_ID \
  --internet-gateway-id $IGW_ID \
  --region $REGION

# Create Subnet 1 (required for HSM)
SUBNET1_OUTPUT=$(aws ec2 create-subnet \
  --vpc-id $VPC_ID \
  --cidr-block 10.0.1.0/24 \
  --availability-zone ${REGION}a \
  --region $REGION \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=hsm-test-subnet-1}]' \
  --output json)

SUBNET1_ID=$(echo $SUBNET1_OUTPUT | jq -r '.Subnet.SubnetId')
echo "✅ Created Subnet 1: $SUBNET1_ID"

# Create Subnet 2 (HSM requires 2 subnets)
SUBNET2_OUTPUT=$(aws ec2 create-subnet \
  --vpc-id $VPC_ID \
  --cidr-block 10.0.2.0/24 \
  --availability-zone ${REGION}b \
  --region $REGION \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=hsm-test-subnet-2}]' \
  --output json)

SUBNET2_ID=$(echo $SUBNET2_OUTPUT | jq -r '.Subnet.SubnetId')
echo "✅ Created Subnet 2: $SUBNET2_ID"

# Create Route Table
RT_OUTPUT=$(aws ec2 create-route-table \
  --vpc-id $VPC_ID \
  --region $REGION \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=hsm-test-rt}]' \
  --output json)

RT_ID=$(echo $RT_OUTPUT | jq -r '.RouteTable.RouteTableId')
echo "✅ Created Route Table: $RT_ID"

# Add route to Internet Gateway
aws ec2 create-route \
  --route-table-id $RT_ID \
  --destination-cidr-block 0.0.0.0/0 \
  --gateway-id $IGW_ID \
  --region $REGION

# Associate subnets with route table
aws ec2 associate-route-table \
  --subnet-id $SUBNET1_ID \
  --route-table-id $RT_ID \
  --region $REGION

aws ec2 associate-route-table \
  --subnet-id $SUBNET2_ID \
  --route-table-id $RT_ID \
  --region $REGION

# Save configuration for HSM lifecycle script
cat > .hsm-vpc-config <<EOF
export VPC_ID=$VPC_ID
export SUBNET1_ID=$SUBNET1_ID
export SUBNET2_ID=$SUBNET2_ID
export IGW_ID=$IGW_ID
export RT_ID=$RT_ID
EOF

echo ""
echo "✅ VPC Setup Complete!"
echo ""
echo "📋 Configuration saved to .hsm-vpc-config:"
echo "   VPC ID: $VPC_ID"
echo "   Subnet 1: $SUBNET1_ID (${REGION}a)"
echo "   Subnet 2: $SUBNET2_ID (${REGION}b)"
echo ""
echo "🚀 You can now run: ./scripts/hsm-lifecycle.sh start"