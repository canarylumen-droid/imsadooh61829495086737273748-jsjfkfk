#!/bin/bash
# ── Audnix ECS Service Bootstrap Script ───────────────────────────────────────
# Run this ONCE to create all ECS services before CI/CD takes over.
#
# Prerequisites:
#   1. ECS Cluster exists: aws ecs create-cluster --cluster-name audnix-prod
#   2. Task definitions registered: aws ecs register-task-definition --cli-input-json ...
#   3. VPC with public subnets + security group
#   4. Application Load Balancer + target group for audnix-api (port 5000)
#
# Usage:
#   export AWS_REGION=us-east-1
#   export ECS_CLUSTER=audnix-prod
#   export VPC_SUBNETS="subnet-xxx,subnet-yyy"
#   export VPC_SECURITY_GROUP="sg-xxx"
#   ./deploy-services.sh
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
ECS_CLUSTER="${ECS_CLUSTER:-audnix-prod}"
SUBNETS="${VPC_SUBNETS:-}"
SECURITY_GROUP="${VPC_SECURITY_GROUP:-}"

if [ -z "$SUBNETS" ] || [ -z "$SECURITY_GROUP" ]; then
  echo "ERROR: Set VPC_SUBNETS and VPC_SECURITY_GROUP environment variables."
  echo "Example:"
  echo '  export VPC_SUBNETS="subnet-0abc1234,subnet-0def5678"'
  echo '  export VPC_SECURITY_GROUP="sg-0123456789abcdef0"'
  exit 1
fi

echo "Creating ECS services in cluster: $ECS_CLUSTER"
echo "Subnets: $SUBNETS"
echo "Security Group: $SECURITY_GROUP"
echo ""

# Common deployment configuration for zero-downtime
DEPLOY_CFG="minimumHealthyPercent=100,maximumPercent=200,deploymentCircuitBreaker={enable=true,rollback=true}"
NETWORK_CFG="awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=ENABLED}"

create_service() {
  local name=$1
  local task_family=$2
  local desired_count=${3:-2}
  local health_grace=${4:-120}

  echo "→ Creating service: $name (family=$task_family, desired=$desired_count)"

  aws ecs create-service \
    --cluster "$ECS_CLUSTER" \
    --service-name "$name" \
    --task-definition "$task_family" \
    --desired-count "$desired_count" \
    --launch-type FARGATE \
    --network-configuration "$NETWORK_CFG" \
    --deployment-configuration "$DEPLOY_CFG" \
    --health-check-grace-period-seconds "$health_grace" \
    --no-cli-pager || echo "  (Service may already exist — skipping)"
}

# ── API Gateway (internet-facing via ALB) ───────────────────────────────────
create_service "audnix-api"            "audnix-worker" 3 180

# ── Socket.io Real-Time Server ────────────────────────────────────────────────
create_service "audnix-socket"         "audnix-worker" 2 120

# ── Worker Services ───────────────────────────────────────────────────────────
create_service "audnix-email-worker"        "audnix-worker"      2 120
create_service "audnix-imap-worker"         "audnix-imap-worker" 5 180
create_service "audnix-outreach-worker"     "audnix-worker"      3 120
create_service "audnix-ai-worker"           "audnix-worker"      2 120
create_service "audnix-social-worker"       "audnix-worker"      2 120
create_service "audnix-billing-worker"      "audnix-worker"      2 120
create_service "audnix-lead-recovery-worker" "audnix-worker"     1 120
create_service "audnix-orchestrator-worker"  "audnix-worker"     1 120
create_service "audnix-rag-worker"           "audnix-worker"     2 120
create_service "audnix-vector-db-service"   "audnix-worker"     1 120
create_service "audnix-infra-scaler"         "audnix-worker"     1 120
create_service "audnix-audit-worker"         "audnix-worker"     1 120

echo ""
echo "✅ All ECS services created. Now attach auto-scaling policies:"
echo "   aws/ecs/attach-autoscaling.sh"
echo ""
echo "Next: update the GitHub secret AWS_DEPLOY_ROLE_ARN and push to main."
