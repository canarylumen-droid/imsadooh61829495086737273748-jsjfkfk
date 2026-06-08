# Audnix AI Monolith Deployment Summary

## Overview
Your application has been configured for monolith deployment where all 15 microservices run in a single container via PM2 process manager.

## Files Created/Modified

### 1. PM2 Configuration
**File**: `ecosystem.config.js`
- Configures all 15 services to run via PM2
- Each service has:
  - Proper script path
  - Environment variables (NODE_ENV, APP_ROLE, PORT)
  - Log files (error/out)
  - Memory limits and restart policies
  - Auto-restart on failure

**Services Configured**:
1. audnix-api-gateway (port 5000, 1GB memory)
2. audnix-socket-server (port 5001, 512MB memory)
3. audnix-worker-email (1GB memory)
4. audnix-worker-imap (512MB memory)
5. audnix-worker-ai (2GB memory)
6. audnix-worker-outreach (2GB memory)
7. audnix-worker-lead-recovery (1GB memory)
8. audnix-worker-social (512MB memory)
9. audnix-worker-billing (512MB memory)
10. audnix-worker-orchestrator (1GB memory)
11. audnix-worker-rag (2GB memory)
12. audnix-worker-audit (512MB memory)
13. audnix-worker-vectordb (512MB memory)
14. audnix-worker-warmup (512MB memory)
15. audnix-infra-scaler (256MB memory)

### 2. Package.json Changes
**Added PM2 dependency**: `pm2: ^5.4.2` in dependencies section

**Added PM2 scripts**:
- `npm run start:pm2` - Start all services via PM2
- `npm run start:pm2:production` - Start in production mode
- `npm run stop:pm2` - Stop all PM2 processes
- `npm run restart:pm2` - Restart all PM2 processes
- `npm run delete:pm2` - Delete all PM2 processes
- `npm run logs:pm2` - View PM2 logs
- `npm run monit:pm2` - Open PM2 monitor

### 3. Dockerfile.production Changes
**Modified CMD section**:
- Added `unified` case that calls `npm run start:pm2:production`
- Changed default fallback from `npm run start:unified` to `npm run start:pm2:production`
- When `APP_ROLE=unified` or no role specified, PM2 starts all 15 services

### 4. AWS App Runner Configuration
**Files**:
- `aws/apprunner/app-runner-config.json` - Service configuration template
- `aws/apprunner/DEPLOYMENT_GUIDE.md` - Complete deployment guide

**Configuration**:
- 4 vCPU, 8 GB memory
- Port 5000 exposed
- Health check on `/health`
- Auto-scaling configuration
- Environment variables template

### 5. AWS ECS Fargate Configuration
**Files**:
- `aws/ecs/task-definition-monolith.json` - Task definition template
- `aws/ecs/ECS_MONOLITH_DEPLOYMENT_GUIDE.md` - Complete deployment guide

**Configuration**:
- 4 vCPU, 8 GB memory per task
- Ports 5000 (API) and 5001 (WebSocket) exposed
- Health check on `/health`
- All secrets configured via AWS Secrets Manager
- CloudWatch logging enabled
- Auto-scaling policies included

## How to Deploy

### Local Testing with PM2
```bash
# Install PM2
npm install

# Start all services
npm run start:pm2:production

# View logs
npm run logs:pm2

# Monitor
npm run monit:pm2

# Stop
npm run stop:pm2
```

### Docker with Unified Mode
```bash
# Build image
docker build -f Dockerfile.production -t audnix-ai:latest .

# Run with unified mode
docker run -e APP_ROLE=unified \
  -e DATABASE_URL=your_db_url \
  -e REDIS_URL=your_redis_url \
  -e SESSION_SECRET=your_secret \
  -e ENCRYPTION_KEY=your_key \
  -p 5000:5000 \
  -p 5001:5001 \
  audnix-ai:latest
```

### AWS App Runner
Follow `aws/apprunner/DEPLOYMENT_GUIDE.md`:
1. Build and push image to ECR
2. Create IAM roles
3. Create auto-scaling configuration
4. Deploy service with `APP_ROLE=unified`

### AWS ECS Fargate
Follow `aws/ecs/ECS_MONOLITH_DEPLOYMENT_GUIDE.md`:
1. Build and push image to ECR
2. Create IAM roles
3. Store secrets in AWS Secrets Manager
4. Create ECS cluster
5. Register task definition
6. Create service with ALB
7. Configure auto-scaling

## Environment Variables Required

### Required for All Deployments
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `SESSION_SECRET` - Session encryption key
- `ENCRYPTION_KEY` - Data encryption key

### AI Services
- `OPENAI_API_KEY` - OpenAI API key
- `GEMINI_API_KEY` - Google Gemini API key

### Payment
- `STRIPE_SECRET_KEY` - Stripe secret key

### Optional
- `MONGODB_URI` - MongoDB connection (lead recovery)
- `ZAI_API_KEY` - ZAI API key
- `DEEPSEEK_API_KEY` - DeepSeek API key
- `SENDGRID_API_KEY` - SendGrid API key
- `TWILIO_ACCOUNT_SID` - Twilio account SID
- `TWILIO_AUTH_TOKEN` - Twilio auth token
- `REDIS_PASSWORD` - Redis password (if using self-hosted)

## Cost Estimates

### AWS App Runner
- Baseline (1 instance): ~$43/month
- Peak (10 instances): ~$430/month

### AWS ECS Fargate
- Baseline (1 task + ALB): ~$165/month
- Peak (10 tasks): ~$1,440/month

## Memory Requirements

Total memory for all services: ~11.5 GB
- API Gateway: 1 GB
- Socket Server: 512 MB
- Email Worker: 1 GB
- IMAP Worker: 512 MB
- AI Worker: 2 GB
- Outreach Worker: 2 GB
- Lead Recovery: 1 GB
- Social Worker: 512 MB
- Billing Worker: 512 MB
- Orchestrator: 1 GB
- RAG Worker: 2 GB
- Audit Worker: 512 MB
- Vector DB: 512 MB
- Warmup Worker: 512 MB
- Infra Scaler: 256 MB

**Note**: The ECS task definition uses 8 GB, which may be insufficient. Consider increasing to 16 GB or scaling to multiple tasks.

## Troubleshooting

### PM2 Services Not Starting
- Check logs: `npm run logs:pm2`
- Verify script paths in ecosystem.config.js
- Ensure all dependencies are installed
- Check environment variables are set

### Docker Container Failing
- Check health endpoint: `curl http://localhost:5000/health`
- Review container logs
- Verify APP_ROLE is set to `unified`
- Ensure PM2 is installed in production dependencies

### AWS Deployment Issues
- Verify IAM roles have correct permissions
- Check security group allows required ports
- Ensure secrets are stored in AWS Secrets Manager
- Review CloudWatch logs for errors

## Next Steps

1. **Test locally** with PM2 to verify all services start correctly
2. **Build Docker image** and test with `APP_ROLE=unified`
3. **Choose deployment platform** (App Runner or ECS Fargate)
4. **Follow deployment guide** for chosen platform
5. **Configure monitoring** (CloudWatch alarms, PM2 monitoring)
6. **Set up auto-scaling** based on your needs
