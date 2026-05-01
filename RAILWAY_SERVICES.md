# ─── AUDNIX RAILWAY SERVICES CONFIG ──────────────────────────────────────────
#
# Each section below corresponds to a separate Railway service.
# To deploy a new worker:
#   1. In Railway dashboard → "Add Service" → "GitHub Repo"
#   2. Set the START COMMAND for that service to the command shown below
#   3. Set all the same env vars as the API service (share via Railway Variables)
#
# ─────────────────────────────────────────────────────────────────────────────

[api]
# The main HTTP/WebSocket API server — serves the frontend + REST endpoints
# Railway Service Name: audnix-api
startCommand = "npm run start"
healthcheckPath = "/health"

[worker_email]
# IMAP IDLE, Email Sync, Email Warmup, Mailbox Health, Lead Redistribution
# Railway Service Name: audnix-worker-email
startCommand = "npm run start:worker:email"

[worker_ai]
# Lead Enrichment, Follow-ups, Closing, Re-engagement, Post-mortem, AI Budget
# Railway Service Name: audnix-worker-ai
startCommand = "npm run start:worker:ai"

[worker_outreach]
# Campaign Engine, Meeting Reminders, Lead Governance, Reputation Monitor
# Railway Service Name: audnix-worker-outreach
startCommand = "npm run start:worker:outreach"

[worker_social]
# Instagram DM Sync, Facebook Webhook Processing
# Railway Service Name: audnix-worker-social
startCommand = "npm run start:worker:social"

[worker_billing]
# Stripe Payment Auto-Approval, Checkout Process[billing-worker]
# Railway Service Name: audnix-billing
startCommand = "npm run start:worker:billing"

[orchestrator-worker]
# Railway Service Name: audnix-orchestrator (The Brain)
# Scale this higher for intelligent decision-making capacity
startCommand = "npm run start:worker:orchestrator"

[knowledge-worker]
# Railway Service Name: audnix-knowledge (RAG / Vector)
# Memory-intensive: Give this service more RAM (1GB-2GB)
startCommand = "npm run start:worker:knowledge"

[audit-worker]
# Railway Service Name: audnix-audit (Observability)
startCommand = "npm run start:worker:audit"
