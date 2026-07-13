# Audnix AI — Complete Deployment Guide

## Table of Contents
1. [System Requirements & Audit](#1-system-requirements--audit)
2. [Install Docker](#2-install-docker)
3. [Local Development Setup](#3-local-development-setup)
4. [Production Deployment (AWS EC2)](#4-production-deployment-aws-ec2)
5. [Post-Deployment Verification](#5-post-deployment-verification)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. System Requirements & Audit

### Hardware Requirements
| Environment | RAM | CPU | Disk | Notes |
|---|---|---|---|---|
| Local dev | 8GB min | 2 cores | 10GB free | Mock Redis works if no real Redis |
| AWS EC2 t3.large | 8GB | 2 vCPU | 20GB gp3 | ~$30/mo reserved |
| AWS EC2 t3.xlarge | 16GB | 4 vCPU | 30GB gp3 | ~$60/mo for 500+ mailboxes |

### Software Prerequisites (Run Audit)
```bash
# Check Node.js (must be 22.x)
node --version   # Must be ^22

# Check npm
npm --version    # Must be ^10

# Check Docker (required for production, optional for local dev)
docker --version
docker compose version

# Check Redis (optional for local — Mock Redis works)
redis-cli --version || echo "Redis CLI not installed (ok for local dev with mock)"

# Check PostgreSQL access (Neon/AWS RDS — external)
psql "$DATABASE_URL" -c "SELECT version();" 2>/dev/null || echo "Test with: npm run test:connections"
```

### Architecture Summary
```
Services:  13 workers + 1 API gateway + 1 socket server
Database:  PostgreSQL (Neon/AWS RDS — external)
Cache:     Redis (dockerized in prod, Mock Redis in local dev)
Queues:    BullMQ on Redis
Storage:   AWS S3 (external)
Email:     Nodemailer SMTP (default) | KumoMTA (opt-in via NEW_EMAIL_BACKEND=kumomta)
Monitoring: Sentry
```

### External Dependencies (Must Be Pre-Configured)
| Service | Config Var | Status |
|---|---|---|
| PostgreSQL | DATABASE_URL | ✅ AWS RDS us-east-1 |
| Redis | REDIS_URL | ✅ Mock works, Upstash/EC2 for prod |
| AWS S3 | S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY | ✅ Configured |
| SendGrid | TWILIO_SENDGRID_API_KEY | ✅ Configured |
| Stripe | STRIPE_SECRET_KEY | ⚠️ Missing in .env |
| OpenAI | OPENAI_API_KEY | ✅ Configured |
| Gemini | GEMINI_API_KEY | ✅ Configured |
| Sentry | OBSERVABILITY_SENTRY_DSN | ✅ Configured |
| Google OAuth | GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | ✅ Configured |
| Calendly | CALENDLY_CLIENT_ID / CALENDLY_CLIENT_SECRET | ✅ Configured |

### Running Audit
```bash
# 1. Test all connections (DB, Redis, S3)
npm run test:connections

# 2. Verify .env has all required vars
node -e "
  const required = [
    'DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET', 'ENCRYPTION_KEY',
    'OPENAI_API_KEY', 'GEMINI_API_KEY', 'TWILIO_SENDGRID_API_KEY'
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('MISSING:', missing.join(', '));
    process.exit(1);
  }
  console.log('All required env vars present');
"

# 3. Run DB migrations (if schema changed)
npm run db:migrate:direct

# 4. Test SMTP/IMAP credentials
npm run test:credentials
```

---

## 2. Install Docker

### Windows (PowerShell Admin)
```powershell
# Install Docker Desktop (recommended for dev)
# Download from: https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe
# Or via winget:
winget install Docker.DockerDesktop

# After install, restart terminal and test:
docker --version
docker compose version
```

### Linux (Ubuntu 24.04 — production server)
```bash
# One-line install:
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose:
sudo apt-get install -y docker-compose-plugin

# Verify:
docker --version
docker compose version

# Enable on boot:
sudo systemctl enable docker
```

### Without Docker (Local Dev Only — No Docker Desktop)
If you can't install Docker, use the Mock Redis approach:
```powershell
# Start Mock Redis (in-memory, no install needed):
node start-mock-redis.cjs

# In another terminal, start the app:
$env:REDIS_TLS='false'; npm run dev
```

---

## 3. Local Development Setup

### One-Time Setup
```powershell
# 1. Clone and install
git clone <your-repo> audnix-ai-project
cd audnix-ai-project
npm install

# 2. Verify .env (copy from .env.example if missing)
Copy-Item .env.example .env

# 3. Critical .env fixes for local dev:
#    REDIS_TLS=false   (must be false for local Redis or Mock Redis)
#    REDIS_URL=redis://127.0.0.1:6379

# 4. Check .env has real secrets (at minimum):
#    DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY, OPENAI_API_KEY
```

### Start Dev Server
```powershell
# Option A: With Mock Redis (no Docker needed)
# Terminal 1: Start Mock Redis
node start-mock-redis.cjs

# Terminal 2: Start the app
$env:REDIS_TLS='false'; npm run dev

# Option B: With Docker Redis
docker run -d --name audnix-redis -p 6379:6379 redis:7-alpine
$env:REDIS_TLS='false'; npm run dev

# Option C: With full Docker Compose (all services)
docker compose up -d
```

### Verify It's Working
```bash
# API should respond:
curl http://localhost:5000/health
# Expected: {"status":"ok","timestamp":"..."} (or similar)

# Frontend should load:
# Open http://localhost:5173 in browser

# Redis should connect:
node -e "require('ioredis').Redis.create().ping().then(r=>console.log('Redis:',r))"
```

### Running Individual Workers (for testing)
```powershell
# API only:
npm run start:api

# Socket server:
npm run start:socket-server

# Email worker:
npm run start:worker:email

# IMAP worker:
npm run start:worker:imap

# AI worker:
npm run start:worker:ai

# All workers concurrently:
npm run start:all-workers
```

---

## 4. Production Deployment (AWS EC2)

### Step 1: Launch EC2 Instance
- **AMI:** Ubuntu 24.04 LTS
- **Type:** t3.large (min) or t3.xlarge (recommended for 500+ mailboxes)
- **Storage:** 20GB gp3 root + 20GB gp3 data
- **Security Group:**
  - Port 22 (SSH) — your IP only
  - Port 80 (HTTP) — 0.0.0.0/0
  - Port 443 (HTTPS) — 0.0.0.0/0
  - Port 5000 (app health check — your IP only, optional)

### Step 2: Configure DNS
```
Type: A Record
Name: audnixai.com
Value: <EC2 Public IP>
TTL: 300

Type: A Record
Name: www.audnixai.com
Value: <EC2 Public IP>
TTL: 300
```

### Step 3: Install Dependencies on EC2
```bash
# SSH into your EC2 instance
ssh -i your-key.pem ubuntu@<EC2-PUBLIC-IP>

# Clone the repo
git clone <your-repo-url> audnix-ai-project
cd audnix-ai-project

# Run the automated setup script:
chmod +x scripts/aws-setup-server.sh
./scripts/aws-setup-server.sh

# This installs: Docker, Docker Compose, git, curl, htop, jq, swap
```

### Step 4: Configure Environment
```bash
# Edit .env with production values:
nano .env

# CRITICAL env vars for production:
# DATABASE_URL     — Neon or AWS RDS PostgreSQL
# REDIS_URL        — Upstash, Redis Cloud, or localhost:6379
# SESSION_SECRET   — 64-char random string
# ENCRYPTION_KEY   — 64-char random hex string
# OPENAI_API_KEY   — Your OpenAI API key
# APP_URL          — https://audnixai.com
# NODE_ENV         — production
# STRIPE_SECRET_KEY — If billing is enabled

# For local Redis on EC2 (instead of Upstash):
# See docs/redis-setup-guide.md for Redis installation
sudo apt install redis-server -y
sudo systemctl enable redis-server
sudo systemctl start redis-server
# Then set: REDIS_URL=redis://127.0.0.1:6379, REDIS_TLS=false
```

### Step 5: Deploy
```bash
# Deploy with docker-compose:
./scripts/aws-deploy.sh

# Or manually:
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# Check status:
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app
```

### Step 6: Setup SSL (HTTPS)
```bash
# After DNS has propagated (5-10 min), run:
./scripts/certbot-init.sh audnixai.com admin@audnixai.com

# Verify HTTPS:
curl https://audnixai.com/health
```

### Step 7: Run Database Migrations
```bash
# SSH into the app container:
docker compose -f docker-compose.prod.yml exec app sh

# Run migrations:
npm run db:migrate:direct

# Exit container:
exit
```

### Alternative: PM2 + Nginx (No Docker)
See `docs/nginx-pm2-deployment-guide.md` for the nginx + PM2 architecture.

---

## 5. Post-Deployment Verification

### Health Checks
```bash
# API health:
curl -fsS http://localhost:5000/health
# Expected: HTTP 200

# Frontend loads:
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/
# Expected: 200

# WebSocket:
# Open browser to https://audnixai.com — WebSocket should connect (check browser console)

# Redis connectivity (if running on EC2):
redis-cli PING
# Expected: PONG

# DB connectivity:
node -e "new (require('pg').Client)(process.env.DATABASE_URL).connect().then(c=>{console.log('DB OK');c.end()})"
```

### Integration Tests
```bash
# 1. Test SMTP credentials for sent mailbox:
node test-credentials.mjs

# 2. Test DNS records (DKIM, SPF, DMARC):
node test-dns.js

# 3. Test full connection suite:
npm run test:connections

# 4. Verify all workers are running:
docker compose -f docker-compose.prod.yml ps
```

### Monitoring
```bash
# View logs:
docker compose -f docker-compose.prod.yml logs -f app

# Check Redis health snapshot:
redis-cli GET health:status:latest

# Check active alerts:
redis-cli LRANGE alerts:active 0 9

# Reset a circuit breaker (if needed):
redis-cli DEL circuit:gmail:stats
```

---

## 6. Troubleshooting

### App Fails to Start
| Symptom | Cause | Fix |
|---|---|---|
| `REDIS_TLS mismatch` | `REDIS_TLS=true` but Redis is non-TLS | Set `REDIS_TLS=false` |
| `ECONNREFUSED :6379` | Redis not running | Start Mock Redis or install real Redis |
| `DATABASE_URL not set` | Missing .env | Copy .env.example → .env and fill values |
| `Cannot find module` | Missing dependencies | Run `npm install` |

### SMTP/IMAP Not Working
| Symptom | Likely Fix |
|---|---|
| AUTHENTICATIONFAILED | Wrong credentials — run `node test-credentials.mjs` |
| Connection timeout | Port blocked by ISP — try port 587 instead of 465 |
| Emails going to spam | Missing DKIM — run `node test-dns.js` to verify DNS |
| Circuit breaker open | Wait 5 min or `redis-cli DEL circuit:*` |

### Docker Issues
| Symptom | Fix |
|---|---|
| `Cannot connect to Docker daemon` | Start Docker Desktop / `sudo systemctl start docker` |
| `docker: command not found` | Install Docker (see Section 2) |
| `port is already allocated` | `docker compose down` then `docker compose up -d` |
| `Container unhealthy` | Check logs: `docker compose logs app` |

### Redis Issues
| Symptom | Fix |
|---|---|
| `NOAUTH Authentication required` | Set `REDIS_URL` with password |
| `MISCONF` | Redis in protected mode — set `bind 127.0.0.1` |
| `OOM command not allowed` | `redis-cli CONFIG SET maxmemory-policy allkeys-lru` |
| Mock Redis crashes | Restart: `node start-mock-redis.cjs` |

### BullMQ Queue Jobs Not Processing
```bash
# Check queue sizes:
redis-cli LLIST bull:*:wait
redis-cli ZCARD bull:*:delayed

# Check stalled jobs:
redis-cli ZCARD bull:*:stalled

# Force process a queue:
node scripts/force-process-queue.ts
```

### Full Reset (Development Only — Wipes Data)
```powershell
# Stop everything:
docker compose down -v

# Clear Redis:
redis-cli FLUSHALL

# Clear local state:
npm run clear-local

# Restart fresh:
npm run dev
```

### Performance Tuning (for 500+ mailboxes)
| File | Setting | Default | Scale Value |
|---|---|---|---|
| `docker-compose.yml` | RAG worker memory | 2048M | 4096M |
| `ecosystem.config.cjs` | API max_memory_restart | 1G | 2G |
| `services/email-worker/src/imap/imap-connection-manager.ts` | HEARTBEAT_TIME | 4 min | 2 min |
| `.env` | CAMPAIGN_CONCURRENCY | 50 | 100 |
| `.env` | IMAP_MAX_SOCKETS | 50 | 100 |

### Known Issues (from latest audit)
| # | Issue | Status |
|---|---|---|
| 1 | Port guessing on failover — user-set port ignored | Unfixed |
| 2 | `secure` flag wrong for string port values | Unfixed |
| 3 | Pool cache key missing port | Unfixed |
| 4 | AI toggle resume floods SMTP (no stagger) | Unfixed |
| 5 | Leads limit mismatch: UI=25k, backend=2.5k | Unfixed |
| 6 | Campaign cap overrides user input (60/day max) | Unfixed |
| 7 | SMTP/IMAP credentials verified working | ✅ Verified |
| 8 | DNS records (MX, SPF, DKIM, DMARC) valid | ✅ Verified |
| 9 | Mock Redis working | ✅ Verified |

---

## Quick Start (30-Second Summary)

```powershell
# === WINDOWS LOCAL DEV ===
git clone <repo> && cd audnix-ai-project
npm install
Copy-Item .env.example .env   # Fill in secrets

# Start Mock Redis + App in separate terminals:
node start-mock-redis.cjs
$env:REDIS_TLS='false'; npm run dev

# === AWS EC2 PRODUCTION ===
ssh -i key.pem ubuntu@<ip>
git clone <repo> && cd audnix-ai-project
./scripts/aws-setup-server.sh
nano .env    # Fill secrets
./scripts/aws-deploy.sh
./scripts/certbot-init.sh audnixai.com admin@audnixai.com
```
