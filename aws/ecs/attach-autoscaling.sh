#!/bin/bash
# ── Audnix ECS Auto-Scaling Bootstrap ─────────────────────────────────────────
# Attach Target Tracking auto-scaling to every worker service.
# Run AFTER deploy-services.sh.
#
# Usage:
#   export AWS_REGION=us-east-1
#   export ECS_CLUSTER=audnix-prod
#   ./attach-autoscaling.sh
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
ECS_CLUSTER="${ECS_CLUSTER:-audnix-prod}"

attach_scaling() {
  local service=$1
  local min=$2
  local max=$3
  local resource_id="service/${ECS_CLUSTER}/${service}"

  echo "→ Attaching auto-scaling to $service (min=$min, max=$max)"

  aws application-autoscaling register-scalable-target \
    --service-namespace ecs \
    --resource-id "$resource_id" \
    --scalable-dimension ecs:service:DesiredCount \
    --min-capacity "$min" \
    --max-capacity "$max" \
    --no-cli-pager 2>/dev/null || true

  # Memory scaling (>70%)
  aws application-autoscaling put-scaling-policy \
    --service-namespace ecs \
    --resource-id "$resource_id" \
    --scalable-dimension ecs:service:DesiredCount \
    --policy-name "${service}-memory" \
    --policy-type TargetTrackingScaling \
    --target-tracking-scaling-policy-configuration \
      '{"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageMemoryUtilization"},"TargetValue":70.0,"ScaleInCooldown":300,"ScaleOutCooldown":60}' \
    --no-cli-pager 2>/dev/null || true

  # CPU scaling (>60%)
  aws application-autoscaling put-scaling-policy \
    --service-namespace ecs \
    --resource-id "$resource_id" \
    --scalable-dimension ecs:service:DesiredCount \
    --policy-name "${service}-cpu" \
    --policy-type TargetTrackingScaling \
    --target-tracking-scaling-policy-configuration \
      '{"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"},"TargetValue":60.0,"ScaleInCooldown":300,"ScaleOutCooldown":60}' \
    --no-cli-pager 2>/dev/null || true
}

# Services that need auto-scaling (all except one-off/jobs)
attach_scaling "audnix-api"               3 10
attach_scaling "audnix-socket"            2 6
attach_scaling "audnix-email-worker"      2 6
attach_scaling "audnix-imap-worker"         5 20
attach_scaling "audnix-outreach-worker"     3 10
attach_scaling "audnix-ai-worker"           2 8
attach_scaling "audnix-social-worker"       2 6
attach_scaling "audnix-billing-worker"      2 6
attach_scaling "audnix-rag-worker"          2 8
attach_scaling "audnix-vector-db-service"   1 4

echo ""
echo "✅ Auto-scaling policies attached."
