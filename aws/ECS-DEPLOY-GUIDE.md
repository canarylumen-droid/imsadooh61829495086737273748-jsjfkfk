# AWS ECS Fargate Deployment Guide — Audnix AI

## Architecture Overview

| Layer | Component |
|-------|-----------|
| Compute | AWS ECS Fargate (serverless containers) |
| Orchestration | Application Load Balancer → ECS Service → Tasks |
| Networking | VPC, Subnets, Security Groups, NAT Gateway |
| Secrets | AWS Secrets Manager |
| CI/CD | GitHub Actions + OIDC |
| Monitoring | CloudWatch Logs, Custom Health Heartbeat, SRE Alerts |
| Queues | BullMQ on Redis ElastiCache |

## Services Deployed

- **api-gateway** — HTTP API + WebSocket
- **email-service** — IMAP IDLE + SMTP + health monitor
- **outreach-worker** — Campaign execution + job watchdog
- **brain-worker** — AI agents + enrichment
- **billing-service** — Stripe webhooks
- **rag-worker** — Vector embedding operations
- **vector-db-service** — Vector store
- **social-worker** — Instagram automation
- **socket-service** — Real-time Socket.io
- **lead-recovery-worker** — Cold lead re-engagement

---

## Bootstrap Steps (Run Once)

### 1. Create ECS Cluster
```bash
aws ecs create-cluster --cluster-name audnix-cluster --region us-east-1
```

### 2. Register Task Definitions
```bash
aws ecs register-task-definition --cli-input-json file://aws/ecs/task-definition.json
aws ecs register-task-definition --cli-input-json file://aws/ecs/task-definition-imap.json
aws ecs register-task-definition --cli-input-json file://aws/ecs/task-definition-migration.json
```

### 3. Create Services (use deploy-services.sh)
```bash
bash aws/ecs/deploy-services.sh
```

### 4. Attach Auto-Scaling
```bash
bash aws/ecs/attach-autoscaling.sh
```

---

## CI/CD Pipeline

The `.github/workflows/ecs-deploy.yml` handles:
1. Build Docker image
2. Push to Amazon ECR
3. Register new task definition revision per service
4. Update ECS service with new revision
5. Wait for stabilization

**Authentication**: GitHub Actions uses OIDC (no long-lived AWS credentials).

**Zero-Downtime**: Rolling updates with deployment circuit breakers. If new tasks fail health checks, ECS auto-rolls back.

---

## SRE Patterns (High Availability)

### 1. FBL Complaint Handler
- **Endpoint**: `POST /api/webhooks/fbl/complaint`
- **Behavior**: Receives abuse feedback loop reports from ISPs (Gmail, Outlook, Yahoo, SendGrid, SES)
- **Action**: Sets `campaignEmails.status = 'suppressed'` and `leads.status = 'unsubscribed'` permanently
- **Files**: `services/api-gateway/src/routes/fbl-webhook.ts`

### 2. Structured Logging
- Every IMAP/SMTP worker logs with `mailboxId`, `podId`, `correlationId`
- Logs are JSON-formatted for CloudWatch/Datadog ingestion
- **Files**: `shared/lib/monitoring/structured-logger.ts`

### 3. Redis Health Heartbeat
- Each worker writes `health:heartbeat:{service}` every 30 seconds
- Consolidated snapshot at `health:status:latest`
- **Files**: `shared/lib/monitoring/health-heartbeat.ts`

### 4. SRE Alerting Monitor
- Runs every 60 seconds inside `email-service`
- Alerts when:
  - **>5 mailboxes disconnected** for >10 minutes
  - **SMTP bounce rate >7%** in 24h window
  - **Any worker missing** heartbeat for >5 minutes
- Alerts written to `alerts:active` Redis list (last 100)
- **Files**: `shared/lib/monitoring/health-heartbeat.ts` (HealthMonitor class)

### 5. Circuit Breaker (SMTP)
- If a provider's transient error rate exceeds **10% in 60s**, the circuit opens
- Queue pauses for **5 minutes** (no new SMTP connections)
- After cooldown, enters HALF-OPEN and tests with 1 job
- Applies to 421/451 transient errors, timeouts, rate limits
- **Files**: `shared/lib/monitoring/circuit-breaker.ts`, `shared/lib/channels/email.ts`

### 6. Exponential Backoff (SMTP 421/451)
- On transient failure: retries with 2s, 4s, 8s delays
- Circuit breaker counts each transient failure
- Port cycling failover (465 ↔ 587 ↔ 2525) on timeouts
- **Files**: `shared/lib/channels/email.ts`

### 7. Graceful Shutdown
- All worker pods handle `SIGTERM`/`SIGINT`
- Pause BullMQ queues, finish in-flight jobs, close DB/Redis/IMAP connections
- ECS `stopTimeout: 120s` allows time for cleanup
- **Files**: All `services/*/index.ts`

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ECS_CONTAINER_METADATA_URI_V4` | ECS metadata endpoint (auto-injected) |
| `ECS_TASK_ID` | Task ID for podId logging |
| `REDIS_URL` | Redis/ElastiCache endpoint |
| `DATABASE_URL` | Neon PostgreSQL endpoint |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` |

---

## Health Check Endpoints

| Service | Path | Port |
|---------|------|------|
| api-gateway | `/health` | 8080 |
| email-service | `/health` | 8081 |
| outreach-worker | `/health` | 8082 |
| brain-worker | `/health` | 8083 |
| billing-service | `/health` | 8084 |
| rag-worker | `/health` | 8085 |
| lead-recovery | `/health` | 8087 |
| social-worker | `/health` | 8088 |
| vector-db-service | `/health` | 8095 |

---

## Operations

### View live health snapshot
```bash
redis-cli GET health:status:latest | jq
```

### Check active alerts
```bash
redis-cli LRANGE alerts:active 0 9
```

### Reset a circuit breaker
```bash
redis-cli DEL circuit:gmail:stats
```

### Force a task redeploy
```bash
aws ecs update-service --cluster audnix-cluster --service email-service --force-new-deployment
```
