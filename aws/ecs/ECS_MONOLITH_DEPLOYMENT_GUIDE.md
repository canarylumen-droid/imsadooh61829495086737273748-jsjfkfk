# AWS ECS Fargate Deployment Guide for Audnix AI Monolith

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **Docker** installed locally
3. **AWS CLI** configured: `aws configure`
4. **ECR Repository** for container storage
5. **ElastiCache Redis** (or external Redis like Redis Cloud)
6. **PostgreSQL** (Neon recommended, or RDS)
7. **VPC** with public and private subnets

## Step 1: Build and Push Docker Image to ECR

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Create ECR repository (if not exists)
aws ecr create-repository --repository-name audnix-ai --region us-east-1

# Build the image
docker build -f Dockerfile.production -t audnix-ai:latest .

# Tag for ECR
docker tag audnix-ai:latest <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/audnix-ai:latest

# Push to ECR
docker push <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/audnix-ai:latest
```

## Step 2: Create IAM Roles

### ECS Task Execution Role
```bash
# Create trust policy
cat > ecs-task-execution-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create role
aws iam create-role --role-name ecsTaskExecutionRole --assume-role-policy-document file://ecs-task-execution-trust.json

# Attach managed policy
aws iam attach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

### ECS Task Role (for application permissions)
```bash
# Create trust policy
cat > ecs-task-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create role
aws iam create-role --role-name ecsTaskRole --assume-role-policy-document file://ecs-task-trust.json

# Attach policies (adjust based on your needs)
aws iam attach-role-policy --role-name ecsTaskRole --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess
aws iam attach-role-policy --role-name ecsTaskRole --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
aws iam attach-role-policy --role-name ecsTaskRole --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
```

## Step 3: Store Secrets in AWS Secrets Manager

```bash
# Store database URL
aws secretsmanager create-secret \
  --name audnix/database-url \
  --secret-string "postgresql://user:password@host:5432/database"

# Store Redis URL
aws secretsmanager create-secret \
  --name audnix/redis-url \
  --secret-string "redis://:password@host:6379"

# Store session secret
aws secretsmanager create-secret \
  --name audnix/session-secret \
  --secret-string "your-random-session-secret"

# Store encryption key
aws secretsmanager create-secret \
  --name audnix/encryption-key \
  --secret-string "your-encryption-key"

# Store API keys
aws secretsmanager create-secret \
  --name audnix/openai-key \
  --secret-string "sk-..."

aws secretsmanager create-secret \
  --name audnix/gemini-key \
  --secret-string "AIza..."

aws secretsmanager create-secret \
  --name audnix/stripe-key \
  --secret-string "sk_live_..."

# Store optional secrets
aws secretsmanager create-secret \
  --name audnix/mongodb-uri \
  --secret-string "mongodb://..."

aws secretsmanager create-secret \
  --name audnix/zai-key \
  --secret-string "your-zai-key"

aws secretsmanager create-secret \
  --name audnix/deepseek-key \
  --secret-string "sk-..."

aws secretsmanager create-secret \
  --name audnix/sendgrid-key \
  --secret-string "SG..."

aws secretsmanager create-secret \
  --name audnix/twilio-sid \
  --secret-string "AC..."

aws secretsmanager create-secret \
  --name audnix/twilio-token \
  --secret-string "your-token"

aws secretsmanager create-secret \
  --name audnix/redis-password \
  --secret-string "your-redis-password"
```

## Step 4: Create ECS Cluster

```bash
# Create cluster
aws ecs create-cluster \
  --cluster-name audnix-monolith \
  --capacity-providers FARGATE \
  --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1,base=1
```

## Step 5: Register Task Definition

```bash
# Replace placeholders in task definition
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1
export IMAGE_TAG=latest

# Register task definition
aws ecs register-task-definition \
  --cli-input-json file://aws/ecs/task-definition-monolith.json
```

## Step 6: Create Security Group

```bash
# Get VPC ID
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)

# Create security group
SG_ID=$(aws ec2 create-security-group \
  --group-name audnix-monolith-sg \
  --description "Security group for Audnix AI Monolith" \
  --vpc-id $VPC_ID \
  --query 'GroupId' --output text)

# Allow inbound HTTP (port 5000)
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 5000 \
  --cidr 0.0.0.0/0

# Allow inbound WebSocket (port 5001)
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 5001 \
  --cidr 0.0.0.0/0

# Allow outbound traffic
aws ec2 authorize-security-group-egress \
  --group-id $SG_ID \
  --protocol -1 \
  --port -1 \
  --cidr 0.0.0.0/0
```

## Step 7: Create ECS Service

```bash
# Get subnet IDs (use public subnets for ALB access)
SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters Name=vpc-id,Values=$VPC_ID \
  --query 'Subnets[*].SubnetId' \
  --output text | tr '\t' ',')

# Create service
aws ecs create-service \
  --cluster audnix-monolith \
  --service-name audnix-monolith-service \
  --task-definition audnix-monolith \
  --desired-count 1 \
  --launch-type FARGATE \
  --platform-version LATEST \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$SG_ID],assignPublicIp=ENABLED}" \
  --deployment-configuration "maximumPercent=200,minimumHealthyPercent=50,deploymentCircuitBreaker={enable=true,rollback=true}" \
  --health-check-grace-period-seconds 180 \
  --enable-execute-command
```

## Step 8: Create Application Load Balancer (Optional but Recommended)

```bash
# Create ALB
ALB_ARN=$(aws elbv2 create-load-balancer \
  --name audnix-monolith-alb \
  --subnets $SUBNET_IDS \
  --security-groups $SG_ID \
  --scheme internet-facing \
  --type application \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

ALB_DNS_NAME=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns $ALB_ARN \
  --query 'LoadBalancers[0].DNSName' --output text)

# Create target group
TG_ARN=$(aws elbv2 create-target-group \
  --name audnix-monolith-tg \
  --port 5000 \
  --protocol HTTP \
  --vpc-id $VPC_ID \
  --target-type ip \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

# Create listener
aws elbv2 create-listener \
  --load-balancer-arn $ALB_ARN \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=$TG_ARN

# Update ECS service to use ALB
aws ecs update-service \
  --cluster audnix-monolith \
  --service audnix-monolith-service \
  --load-balancers "targetGroupArn=$TG_ARN,containerName=audnix-monolith,containerPort=5000"
```

## Step 9: Configure Auto Scaling

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/audnix-monolith/audnix-monolith-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 1 \
  --max-capacity 10

# Create scale-out policy (scale up)
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/audnix-monolith/audnix-monolith-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name audnix-scale-out \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleOutCooldown": 300,
    "ScaleInCooldown": 300
  }'

# Create scale-in policy (scale down)
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/audnix-monolith/audnix-monolith-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name audnix-scale-in \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 30.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleOutCooldown": 300,
    "ScaleInCooldown": 600
  }'
```

## Step 10: Verify Deployment

```bash
# Check service status
aws ecs describe-services \
  --cluster audnix-monolith \
  --services audnix-monolith-service

# Check task status
aws ecs list-tasks \
  --cluster audnix-monolith \
  --service-name audnix-monolith-service

# View logs
aws logs tail /ecs/audnix-monolith --follow

# Execute command in container (for debugging)
aws ecs execute-command \
  --cluster audnix-monolith \
  --task <TASK_ID> \
  --container audnix-monolith \
  --command "/bin/sh" \
  --interactive
```

## Step 11: Configure CloudWatch Alarms

```bash
# CPU utilization alarm
aws cloudwatch put-metric-alarm \
  --alarm-name audnix-monolith-high-cpu \
  --alarm-description "Alert when CPU > 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ServiceName,Value=audnix-monolith-service Name=ClusterName,Value=audnix-monolith

# Memory utilization alarm
aws cloudwatch put-metric-alarm \
  --alarm-name audnix-monolith-high-memory \
  --alarm-description "Alert when Memory > 80%" \
  --metric-name MemoryUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ServiceName,Value=audnix-monolith-service Name=ClusterName,Value=audnix-monolith
```

## Cost Estimate

- **ECS Fargate**: $0.04048/vCPU-hour + $0.004445/GB-hour
- **4 vCPU, 8 GB**: ~$0.20/hour per task
- **1 task running 24/7**: ~$144/month
- **ALB**: ~$0.025/hour + $0.008/LCU-hour (~$20/month)
- **Total baseline**: ~$165/month
- **Auto-scaling to 10 tasks peak**: ~$1,440/month peak

## Troubleshooting

### Tasks not starting
- Check CloudWatch Logs: `/ecs/audnix-monolith`
- Verify secrets are correctly configured
- Ensure security group allows outbound traffic
- Check VPC has internet gateway for public IP access

### Health check failing
- Verify `/health` endpoint is accessible
- Check PM2 processes are running
- Review task definition health check configuration
- Increase `startPeriod` if services take longer to start

### Memory issues
- Monitor PM2 process memory usage
- Increase task memory allocation
- Consider scaling to multiple tasks
- Review DB connection pool settings

### PM2 processes crashing
- Check individual service logs in CloudWatch
- Verify environment variables are set correctly
- Ensure Redis and PostgreSQL are accessible
- Review PM2 configuration in `ecosystem.config.js`

## Monitoring

Enable CloudWatch Container Insights for detailed metrics:

```bash
aws ecs update-cluster-settings \
  --cluster audnix-monolith \
  --settings name=containerInsights,value=enabled
```

## Cleanup

```bash
# Delete service
aws ecs delete-service \
  --cluster audnix-monolith \
  --service audnix-monolith-service --force

# Delete task definition
aws ecs deregister-task-definition --task-definition audnix-monolith

# Delete cluster
aws ecs delete-cluster --cluster audnix-monolith

# Delete ALB
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN
```
