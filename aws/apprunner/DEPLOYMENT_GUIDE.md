# AWS App Runner Deployment Guide for Audnix AI Monolith

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **Docker** installed locally
3. **AWS CLI** configured: `aws configure`
4. **ECR Repository** for container storage
5. **ElastiCache Redis** (or external Redis like Redis Cloud)
6. **PostgreSQL** (Neon recommended, or RDS)

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

### App Runner Service Role
```bash
# Create trust policy file
cat > apprunner-trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "build.apprunner.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create role
aws iam create-role --role-name AppRunnerServiceRole --assume-role-policy-document file://apprunner-trust-policy.json

# Attach policies
aws iam attach-role-policy --role-name AppRunnerServiceRole --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

### App Runner Instance Role
```bash
# Create trust policy
cat > apprunner-instance-trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "apprunner.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create role
aws iam create-role --role-name AppRunnerInstanceRole --assume-role-policy-document file://apprunner-instance-trust-policy.json

# Attach policies (adjust based on your needs)
aws iam attach-role-policy --role-name AppRunnerInstanceRole --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess
aws iam attach-role-policy --role-name AppRunnerInstanceRole --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
```

## Step 3: Create Auto Scaling Configuration

```bash
aws apprunner create-auto-scaling-configuration \
  --auto-scaling-configuration-name audnix-autoscaling \
  --max-concurrency 25 \
  --min-size 1 \
  --max-size 10 \
  --tags Key=Project,Value=AudnixAI
```

Note the returned `AutoScalingConfigurationArn` for the next step.

## Step 4: Deploy to App Runner

### Using AWS CLI

```bash
aws apprunner create-service \
  --service-name audnix-ai-monolith \
  --source-configuration '{
    "imageRepository": {
      "imageIdentifier": "<YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/audnix-ai:latest",
      "imageConfiguration": {
        "port": "5000",
        "environmentVariables": [
          {"name": "NODE_ENV", "value": "production"},
          {"name": "APP_ROLE", "value": "unified"},
          {"name": "PORT", "value": "5000"}
        ]
      },
      "imageRepositoryType": "ECR"
    },
    "autoDeploymentsEnabled": true,
    "authenticationConfiguration": {
      "accessRoleArn": "arn:aws:iam::<YOUR_ACCOUNT_ID>:role/AppRunnerServiceRole"
    }
  }' \
  --instance-configuration '{
    "cpu": "4096",
    "memory": "8192",
    "instanceRoleArn": "arn:aws:iam::<YOUR_ACCOUNT_ID>:role/AppRunnerInstanceRole"
  }' \
  --health-check-configuration '{
    "protocol": "HTTP",
    "path": "/health",
    "interval": 30,
    "timeout": 5,
    "healthyThreshold": 1,
    "unhealthyThreshold": 3
  }' \
  --auto-scaling-configuration-arn <YOUR_AUTOSCALING_ARN> \
  --tags Key=Project,Value=AudnixAI
```

### Using AWS Console

1. Go to AWS App Runner console
2. Click "Create service"
3. Source: "Container image"
4. Container image: ECR, select `audnix-ai:latest`
5. Deployment settings: Enable automatic deployments
6. Service name: `audnix-ai-monolith`
7. Environment:
   - CPU: 4 vCPU
   - Memory: 8 GB
   - Port: 5000
8. Environment variables (add all from your `.env`):
   ```
   NODE_ENV=production
   APP_ROLE=unified
   PORT=5000
   DATABASE_URL=your_database_url
   REDIS_URL=your_redis_url
   SESSION_SECRET=your_session_secret
   ENCRYPTION_KEY=your_encryption_key
   OPENAI_API_KEY=your_openai_key
   GEMINI_API_KEY=your_gemini_key
   STRIPE_SECRET_KEY=your_stripe_key
   # ... add all other required env vars
   ```
9. Health check: HTTP, path `/health`
10. Auto scaling: Min 1, Max 10 instances
11. Create service

## Step 5: Configure Environment Variables

After service creation, add all required environment variables:

**Required Variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `SESSION_SECRET` - Session encryption key
- `ENCRYPTION_KEY` - Data encryption key
- `OPENAI_API_KEY` - OpenAI API key
- `GEMINI_API_KEY` - Google Gemini API key
- `STRIPE_SECRET_KEY` - Stripe secret key
- `REDIS_PASSWORD` - Redis password (if using self-hosted)

**Optional Variables:**
- `MONGODB_URI` - MongoDB connection (for lead recovery)
- `ZAI_API_KEY` - ZAI API key
- `DEEPSEEK_API_KEY` - DeepSeek API key
- `SENDGRID_API_KEY` - SendGrid API key
- `TWILIO_ACCOUNT_SID` - Twilio account SID
- `TWILIO_AUTH_TOKEN` - Twilio auth token

## Step 6: Verify Deployment

```bash
# Get service status
aws apprunner describe-service --service-arn <YOUR_SERVICE_ARN>

# View logs
aws apprunner list-operations --service-arn <YOUR_SERVICE_ARN>

# Get service URL
aws apprunner describe-service --service-arn <YOUR_SERVICE_ARN> --query 'Service.ServiceUrl' --output text
```

## Step 7: Configure Custom Domain (Optional)

```bash
# Add custom domain
aws apprunner associate-custom-domain \
  --service-arn <YOUR_SERVICE_ARN> \
  --domain-name api.yourdomain.com \
  --enable-www-subdomain true
```

## Troubleshooting

### Service not starting
- Check CloudWatch Logs: `/aws/apprunner/audnix-ai-monolith`
- Verify environment variables are set correctly
- Ensure Redis and PostgreSQL are accessible

### Health check failing
- Verify `/health` endpoint is accessible
- Check port 5000 is exposed
- Review PM2 logs in CloudWatch

### Memory issues
- Increase memory allocation in instance configuration
- Monitor PM2 process memory usage
- Consider scaling to multiple instances

## Cost Estimate

- **App Runner**: ~$0.007/GB-hour + $0.000251/vCPU-hour
- **4 vCPU, 8 GB**: ~$0.06/hour per instance
- **1 instance running 24/7**: ~$43/month
- **Auto-scaling to 10 instances peak**: ~$430/month peak

## Monitoring

- Enable CloudWatch Logs for all PM2 processes
- Set up CloudWatch Alarms for:
  - CPU utilization > 80%
  - Memory utilization > 80%
  - Health check failures
  - Error rates
