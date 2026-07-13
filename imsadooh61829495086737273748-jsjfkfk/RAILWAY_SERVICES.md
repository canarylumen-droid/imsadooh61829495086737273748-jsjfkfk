# Audnix Railway Services Config

Each entry below is a separate Railway service. Do not deploy production through a single shared `npm run start` process. Every service must use the same repo, the optimized `Dockerfile.production` build, shared environment variables, and its own start command.

Required shared variables:

- `DATABASE_URL`
- `REDIS_URL` using your Redis Cloud private `rediss://` endpoint
- `REDIS_TLS=true`
- `REDIS_PRIVATE_ENDPOINT_REQUIRED=true`
- `REDIS_PRIVATE_HOST_SUFFIXES` set to the private DNS suffix used by your Redis Cloud provider if it is not one of `.internal`, `.private`, `privatelink`, `private-link`, or `railway.internal`
- `REDIS_CLOUD_HA_ENABLED=true` and `REDIS_CLOUD_AOF_ENABLED=true` after enabling HA/AOF on the Redis Cloud database
- `REDIS_LATENCY_P99_SLO_MS=15`
- `ENCRYPTION_KEY`
- `SESSION_SECRET`
- `MONGODB_URI` or `MONGO_URL` for Lead Recovery Mongo storage
- Provider/API keys used by the specific worker
- `QUEUE_AUTOSCALER_ENABLED=true` only for `audnix-infra-scaler`
- Railway scaler webhook variables only for `audnix-infra-scaler`

## Service Matrix

| Railway service | Runtime role | Start command | Health check |
| --- | --- | --- | --- |
| `audnix-api-gateway` | Fast HTTP API gateway and REST routing only | `npm run start:api-gateway` | `/health` |
| `audnix-socket-server` | Socket.io realtime dashboard and chat sync | `npm run start:socket-server` | `/health` |
| `audnix-worker-email` | Email sync, warmup, mailbox health, verification, and routing workers | `npm run start:worker:email` | `/health` |
| `audnix-worker-imap` | IMAP mailbox listener and mail ingestion worker | `npm run start:worker:imap` | `/health` |
| `audnix-worker-ai` | Autonomous conversational objection handling | `npm run start:worker:ai` | `/health` |
| `audnix-worker-outreach` | Outbound campaign execution and send pipeline | `npm run start:worker:outreach` | `/health` |
| `audnix-worker-lead-recovery` | Mongo-backed email Lead Recovery 90-day sync and AI recovery analysis | `npm run start:worker:lead-recovery` | `/health` |
| `audnix-worker-social` | Outgoing multi-channel social steps and DM sync | `npm run start:worker:social` | `/health` |
| `audnix-worker-billing` | Payment events, ledger jobs, plan boundaries | `npm run start:worker:billing` | `/health` |
| `audnix-worker-orchestrator` | Campaign timeline routing and strategic state shifts | `npm run start:worker:orchestrator` | `/health` |
| `audnix-worker-knowledge` | Vector embeddings and dynamic lookup runner | `npm run start:worker:knowledge` | `/health` |
| `audnix-worker-audit` | Telemetry, email tracking logs, safety audit events | `npm run start:worker:audit` | `/health` |
| `audnix-vector-db` | Vector operation worker for embedding upserts/deletes/search | `npm run start:worker:vectordb` | `/health` |
| `audnix-infra-scaler` | Railway queue-depth autoscaler daemon | `npm run start:infra:scaler` | `/health` |

## Railway Webhook Scaling

The infra scaler does not change mailbox delivery limits. It only scales worker containers based on BullMQ backlog.

Set one webhook URL per target service on `audnix-infra-scaler`:

- `RAILWAY_SCALE_WEBHOOK_AI`
- `RAILWAY_SCALE_WEBHOOK_SOCIAL`
- `RAILWAY_SCALE_WEBHOOK_BILLING`
- `RAILWAY_SCALE_WEBHOOK_ORCHESTRATOR`
- `RAILWAY_SCALE_WEBHOOK_KNOWLEDGE`
- `RAILWAY_SCALE_WEBHOOK_AUDIT`
- `RAILWAY_SCALE_WEBHOOK_EMAIL`
- `RAILWAY_SCALE_WEBHOOK_IMAP`
- `RAILWAY_SCALE_WEBHOOK_OUTREACH`
- `RAILWAY_SCALE_WEBHOOK_LEAD_RECOVERY`
- `RAILWAY_SCALE_WEBHOOK_VECTOR_DB`

Each webhook receives:

```json
{
  "service": "audnix-worker-ai",
  "desiredReplicas": 4,
  "currentReplicas": 2,
  "backlog": 250,
  "queues": ["aiProcessing", "leadScoring", "sentimentAnalysis"],
  "reason": "scale-up",
  "timestamp": "2026-05-22T00:00:00.000Z"
}
```

Optional tuning variables:

- `QUEUE_AUTOSCALER_POLL_MS=15000`
- `QUEUE_AUTOSCALER_SCALE_UP_AT=100`
- `QUEUE_AUTOSCALER_SCALE_DOWN_AT=20`
- `QUEUE_AUTOSCALER_COOLDOWN_MS=180000`
- `QUEUE_AUTOSCALER_MIN_REPLICAS=1`
- `QUEUE_AUTOSCALER_MAX_REPLICAS=10`

Use `railway.services.json` as the source-of-truth manifest when creating or auditing Railway services.
