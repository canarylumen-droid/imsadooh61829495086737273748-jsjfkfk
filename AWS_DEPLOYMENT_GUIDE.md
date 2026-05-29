# Audnix AI — AWS EC2 Production Deployment Guide

> **Last updated to reflect all production fixes.** Follow every step in order.

> **Cost: ~$65/month** | **Setup Time: 1-2 hours** | **$100 credit lasts: 6-7 weeks**

---

## Table of Contents

1. [What You're Building](#what-youre-building)
2. [Prerequisites](#prerequisites)
3. [Step 1: Launch EC2 Instance](#step-1-launch-ec2-instance)
4. [Step 2: Configure DNS](#step-2-configure-dns)
5. [Step 3: Run Server Setup](#step-3-run-server-setup)
6. [Step 4: Configure Environment](#step-4-configure-environment)
7. [Step 5: Deploy](#step-5-deploy)
8. [Step 6: Setup SSL (HTTPS)](#step-6-setup-ssl-https)
9. [Step 7: Verify Everything Works](#step-7-verify-everything-works)
10. [Step 8: Setup CI/CD (Optional)](#step-8-setup-cicd-optional)
11. [EKS: Sharded IMAP for 500+ Mailboxes (Enterprise)](#eks-sharded-imap-for-500-mailboxes-enterprise)
12. [ECS Fargate: Zero-Downtime Worker Migration](#ecs-fargate-zero-downtime-worker-migration)
13. [Monitoring & Maintenance](#monitoring--maintenance)
14. [Troubleshooting](#troubleshooting)
15. [Architecture](#architecture)

---

## What You're Building

One EC2 server running your entire Audnix AI platform:

```
┌─────────────────────────────────────────────────────────┐
│                    AWS EC2 (t3.large)                   │
│                      Ubuntu 24.04                       │
│                                                         │
│  ┌─────────────┐    ┌──────────────────────────────┐   │
│  │   Nginx     │───▶│  App Container (Unified)     │   │
│  │  (SSL/443)  │    │  • API Gateway (port 5000)     │   │
│  │  (HTTP/80)  │    │  • Brain Worker (AI)           │   │
│  └─────────────┘    │  • Email Worker (IMAP/SMTP)    │   │
│                     │  • Outreach Worker             │   │
│  ┌─────────────┐    │  • Billing Worker              │   │
│  │   Redis     │◀──▶│  • Lead Recovery Worker        │   │
│  │  (Queues)   │    │  • All other workers           │   │
│  └─────────────┘    └──────────────────────────────┘   │
│                                                         │
│  External Services:                                     │
│  • Neon PostgreSQL (Database)                         │
│  • S3 (File Storage)                                    │
│  • Stripe (Payments)                                    │
│  • OpenAI/Gemini (AI)                                   │
│  • SendGrid/Twilio (Email/SMS)                          │
└─────────────────────────────────────────────────────────┘
```

**All 15+ microservices run inside ONE container** using "unified mode" to save RAM.

---

## Prerequisites

Before you start, have these ready:

| Requirement | Where to Get |
|------------|-------------|
| **AWS Account** | [aws.amazon.com](https://aws.amazon.com) (with $100 credit applied) |
| **Domain Name** | Buy from Namecheap, Cloudflare, or GoDaddy |
| **Neon DB** | [neon.tech](https://neon.tech) (free tier: 500MB) |
| **Redis** | [console.upstash.com](https://console.upstash.com) (free tier: 10K cmds/day) |
| **GitHub Repo** | Your repo URL (already set up) |
| **API Keys** | OpenAI, Stripe, SendGrid, etc. (see `.env.aws.example`) |

---

## Step 1: Launch EC2 Instance

1. Go to [AWS EC2 Console](https://console.aws.amazon.com/ec2)
2. Click **Launch Instance**
3. Configure:
   - **Name:** `audnix-prod`
   - **OS:** Ubuntu Server 24.04 LTS
   - **Instance Type:** `t3.large` (2 vCPU, 8GB RAM) — **$60.74/month**
   - **Key Pair:** Create new (download `.pem` file, keep it safe!)
   - **Network:** Default VPC
   - **Auto-assign public IP:** ✅ Enable
   - **Storage:** 30 GB GP3 (default is 8GB, increase it)

4. **Security Group** (Firewall Rules):

| Type | Port | Source | Purpose |
|------|------|--------|---------|
| SSH | 22 | My IP | Remote access |
| HTTP | 80 | 0.0.0.0/0 | Web traffic |
| HTTPS | 443 | 0.0.0.0/0 | Secure web traffic |

5. Click **Launch Instance**
6. Wait 2-3 minutes for it to start

### Connect to your server:

```bash
# On Mac/Linux
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# On Windows (PowerShell)
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
```

> Your EC2 IP is shown in the AWS console under "Public IPv4 address"

---

## Step 2: Configure DNS

Point your domain to your EC2 IP:

1. Go to your domain registrar (Namecheap, Cloudflare, etc.)
2. Find **DNS Management**
3. Create an **A Record**:
   - **Type:** A
   - **Name:** @ (root) or `app` (subdomain)
   - **Value:** YOUR_EC2_IP_ADDRESS
   - **TTL:** 300 (5 minutes)
4. Wait 5-10 minutes for DNS to propagate
5. Verify: `ping your-domain.com` should show your EC2 IP

---

## Step 3: Run Server Setup

On your EC2 server (SSH session), run:

```bash
cd ~
git clone https://github.com/canarylumen-droid/imsadooh61829495086737273748-jsjfkfk.git audnix
cd audnix
chmod +x scripts/*.sh
./scripts/aws-setup-server.sh
```

This will:
- ✅ Install Docker & Docker Compose
- ✅ Install `dnsutils` (needed for certbot DNS check)
- ✅ Set up 4GB swap (critical for stability under load)
- ✅ Create `nginx/conf.d/` directory
- ✅ Create `.env` template (if one doesn't exist)
- ✅ Configure Docker daemon with log rotation (100MB max per container)

**Takes ~5 minutes. After it finishes, log out and log back in so Docker permissions apply:**
```bash
exit
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
cd ~/audnix
```

---

## Step 3b: Set Up External Redis (Required)

The app uses Redis for BullMQ job queues, real-time pub/sub, and sessions. You need an external Redis.

### Upstash (Recommended — free tier)

1. Go to **[console.upstash.com](https://console.upstash.com)** → Create Account
2. Click **"Create Database"**
3. Settings:
   - **Name:** `audnix-redis`
   - **Type:** Regional
   - **Region:** Pick the same region as your EC2 (e.g. `us-east-1`)
   - **TLS:** ✅ Enabled (required)
4. Click **Create**
5. On the database page, go to the **"Details"** tab
6. Under **"Connect"** → **Node.js** section — copy the URL that starts with `rediss://`
   > It looks like: `rediss://default:AbCdEf@global-knowing-xxx.upstash.io:6380`
7. Paste it as `REDIS_URL` in your `.env` file

### Redis Cloud (Alternative — free: 30MB)

1. Go to **[redis.io/try-free](https://redis.io/try-free)**
2. Create a free database → copy the **Public Endpoint**
3. Your URL format: `redis://default:PASSWORD@HOST.redns.redis-cloud.com:PORT`

> **Note:** Upstash is preferred because it has a better free tier, automatic TLS, and is pay-per-use (you only pay when your app actually uses it).

---

## Step 4: Configure Environment

Edit the `.env` file with your real secrets:

```bash
nano .env
```

**Critical variables to set:**

```env
# Database (from Neon console)
DATABASE_URL=postgresql://user:pass@neon-host/audnix?sslmode=require

# Redis (from Upstash or Redis Cloud — see Step 3b)
# ⚠️  REQUIRED: app will not start without this
REDIS_URL=rediss://default:PASSWORD@host.upstash.io:6380

# Security (generate with: openssl rand -hex 32)
SESSION_SECRET=your-64-char-secret
ENCRYPTION_KEY=your-32-char-key

# AI (from OpenAI dashboard)
OPENAI_API_KEY=sk-...

# Stripe (from Stripe dashboard)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Email (from SendGrid)
SENDGRID_API_KEY=SG.xxx

# OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

> See `.env.aws.example` for the complete list with instructions for each.

**Generate secure secrets:**
```bash
# Run these and paste the output into .env
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 16   # ENCRYPTION_KEY
```

**Save and exit:** `Ctrl+X`, then `Y`, then `Enter`

---

## Step 5: Deploy

Deploy your application:

```bash
./scripts/aws-deploy.sh
```

This will:
1. ✅ Validate your `.env` file (checks all required keys)
2. ✅ `git pull origin main` (get latest code)
3. ✅ Build the Docker image (with layer cache for speed)
4. ✅ Start all containers (app, nginx, redis, certbot)
5. ✅ Run health checks (waits up to 2 min for startup)
6. ✅ Print memory usage summary

**First build: ~10-15 minutes.** Subsequent deploys: ~2-3 minutes.

> If you need a clean build (no cache): `./scripts/aws-deploy.sh --no-cache`

---

## Step 6: Setup SSL (HTTPS)

**Only do this AFTER:**
- ✅ DNS is pointing to your EC2 IP (verify with `ping your-domain.com`)
- ✅ The app is running (`docker-compose -f docker-compose.prod.yml ps` shows healthy)

```bash
./scripts/certbot-init.sh your-domain.com your-email@domain.com
```

This will:
1. ✅ Verify nginx is running (webroot mode — nginx stays up during cert request)
2. ✅ Check DNS resolves to this server
3. ✅ Request free SSL cert from Let's Encrypt
4. ✅ Generate `nginx/conf.d/ssl.conf` with your domain
5. ✅ Reload nginx (HTTPS active immediately)
6. ✅ Set up auto-renewal cron (2x daily)

**Verify:**
- Visit `https://your-domain.com` — you should see the green lock 🔒
- HTTP (`http://your-domain.com`) redirects to HTTPS automatically

> **Note:** Certs auto-renew every 90 days. The certbot container checks every 12 hours.

---

## Step 7: Verify Everything Works

### 1. Check all containers are running
```bash
docker-compose -f docker-compose.prod.yml ps
```

You should see:
```
NAME           STATUS    PORTS
audnix-app     Up 2 min  
audnix-nginx   Up 2 min  0.0.0.0:80->80, 0.0.0.0:443->443
audnix-redis   Up 2 min  6379/tcp
```

### 2. Test the API
```bash
curl -s https://your-domain.com/health | jq
```

Should return: `{"status":"ok",...}`

### 3. Test login/signup
- Visit `https://your-domain.com`
- Try creating an account
- Check email arrives (if SMTP configured)

### 4. Test AI functionality
- Go to dashboard → Inbox
- Send a test message to a lead
- AI should generate a reply

### 5. Check worker health endpoints
```bash
# AI Worker
curl http://localhost:8082/health

# Email Worker
curl http://localhost:8081/health

# Outreach Worker
curl http://localhost:8083/health
```

---

## Step 8: Setup CI/CD (Optional)

Automatically deploy when you push to GitHub:

### 1. Add GitHub Secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions → New repository secret

Add these secrets:

| Secret Name | Value |
|------------|-------|
| `AWS_EC2_HOST` | Your EC2 public IP |
| `AWS_EC2_USER` | `ubuntu` |
| `AWS_EC2_SSH_KEY` | Full contents of your `.pem` key file |
| `AWS_EC2_APP_DIR` | Path to repo on server, e.g. `/home/ubuntu/audnix` |

### 2. Push to main branch

```bash
git add .
git commit -m "deploy: ready for production"
git push origin main
```

GitHub Actions will:
1. SSH to your EC2 server
2. `git pull origin main` to get latest code
3. Run `./scripts/aws-deploy.sh` (builds locally on EC2)

**Deployment from push takes ~5 minutes.** No container registry needed — build happens on the EC2 server itself.

---

## Monitoring & Maintenance

### View Logs
```bash
# App logs (real-time)
docker-compose -f docker-compose.prod.yml logs -f app

# Nginx access logs
docker-compose -f docker-compose.prod.yml logs -f nginx

# Redis logs
docker-compose -f docker-compose.prod.yml logs -f redis

# All containers
docker-compose -f docker-compose.prod.yml logs -f
```

### Resource Usage
```bash
# Live stats
docker stats

# Or use htop (installed by setup script)
htop
```

### Database Backups
```bash
# Manual backup
./scripts/backup-db.sh

# Set up daily automated backups (runs at 3am)
(crontab -l 2>/dev/null; echo "0 3 * * * $(pwd)/scripts/backup-db.sh >> $(pwd)/logs/backup.log 2>&1") | crontab -
```

### SSL Certificate Renewal
Already automated! The certbot container renews certificates every 12 hours.

To check:
```bash
docker-compose -f docker-compose.prod.yml exec certbot certbot certificates
```

### Restart Everything
```bash
docker-compose -f docker-compose.prod.yml restart
```

### Update (Pull Latest Code)
```bash
git pull origin main
./scripts/aws-deploy.sh
```

---

## Troubleshooting

### ❌ "Cannot connect to EC2 via SSH"
- Check Security Group: Port 22 must be open to your IP
- Check you're using the right `.pem` key file
- Check instance is running (green dot in AWS console)

### ❌ "502 Bad Gateway" or "Connection Refused"
```bash
# Check if app is running
docker-compose -f docker-compose.prod.yml ps

# Check app logs
docker-compose -f docker-compose.prod.yml logs --tail=100 app

# Restart
docker-compose -f docker-compose.prod.yml restart app
```

### ❌ "Out of Memory" (OOM)
```bash
# Check memory
docker stats --no-stream

# Free up space
docker system prune -f
docker volume prune -f

# Check swap is active
free -h
```

If consistently OOM, you may need to:
- Upgrade to `t3.xlarge` (16GB RAM, ~$120/month)
- Or disable some workers (edit `unified-worker-starter.ts`)

### ❌ "Database connection failed"
- Check `DATABASE_URL` in `.env`
- Verify Neon DB is accessible from your EC2 IP
- In Neon: Project → Settings → Allowed IPs → Add your EC2 IP

### ❌ "SSL certificate error"
```bash
# Re-run full SSL setup
./scripts/certbot-init.sh your-domain.com your-email@domain.com

# Or force renew existing cert
docker-compose -f docker-compose.prod.yml run --rm certbot \
  certbot renew --webroot --webroot-path=/var/www/certbot --force-renewal

# Reload nginx after renew
docker exec audnix-nginx nginx -s reload
```

### ❌ "nginx: [emerg] cannot load certificate"
This means certbot hasn't run yet or the cert path is wrong:
```bash
# Verify cert exists
docker-compose -f docker-compose.prod.yml run --rm certbot certbot certificates

# Re-run certbot-init.sh
./scripts/certbot-init.sh your-domain.com your-email@domain.com
```

### ❌ "nginx conf.d/ssl.conf: No such file"
SSL config is missing — either certbot hasn't run yet (expected, access via HTTP works fine), or run:
```bash
./scripts/certbot-init.sh your-domain.com your-email@domain.com
```

### ❌ "Workers not starting"
```bash
# Check unified worker logs
docker-compose -f docker-compose.prod.yml logs app | grep -i "worker\|unified"
```

### ❌ Build fails / TypeScript errors
```bash
# Run type check locally first
npm run check

# Rebuild with no cache
docker-compose -f docker-compose.prod.yml build --no-cache
```

---

## Architecture

### Memory Budget (t3.large = 8GB RAM)

| Service | Limit | Purpose |
|---------|-------|---------|
| OS + Docker daemon | ~1GB | Base system |
| **App (Unified)** | **5GB** | API + all 5 worker services |
| Nginx | 128MB | Reverse proxy, SSL |
| Redis | External | Upstash/Redis Cloud — zero container RAM |
| Swap (fallback) | 4GB | Prevents OOM crashes |
| **Total allocated** | **~6.1GB** | ✅ Fits in 8GB with headroom |

### Why Unified Mode?

Instead of 15 separate containers (which would need ~12GB+ RAM), we run everything in one Node.js process:

- **API Gateway** handles HTTP requests and WebSocket connections
- **Workers** run in the same process, processing background jobs
- **BullMQ** distributes work via Redis queues

If one worker crashes, the API stays alive (handled by unified-worker-starter.ts).

---

## 💰 Cost Breakdown & Pricing Model

> **Short answer: AWS EC2 is mostly FLAT RATE.** You pay for the server whether you use it or not.

### Monthly Costs

| Service | Pricing Model | Monthly Cost | Notes |
|---------|--------------|-------------|-------|
| **EC2 t3.large** | **Flat rate** | **$60.74** | ~$0.0832/hr × 730 hrs. Billed whether idle or at 100% load. |
| **EBS Storage (30GB)** | Flat rate | **$2.40** | $0.08/GB/month |
| **Data Transfer OUT** | Pay-per-use | **$0–$9** | Free first 100GB/month. Then $0.09/GB. |
| **Neon PostgreSQL** | Free / Pay-per-use | **$0–$19** | Free: 500MB storage, 0.5GB RAM. Pro plan $19/mo if exceeded. |
| **Redis (Upstash)** | Pay-per-use | **$0–$5** | Free: 10K commands/day. Then $0.20 per 100K commands. Most apps stay free. |
| **SSL Certificate** | Free | **$0** | Let's Encrypt, auto-renewed |
| **S3 (backups only)** | Pay-per-use | **~$0.02** | ~1GB backups × $0.023/GB |
| | | | |
| **Total (minimal)** | | **~$63/month** | Fresh start, low traffic |
| **Total (typical)** | | **~$70/month** | With some outbound data |
| **Total (heavy)** | | **~$90/month** | High traffic + Neon Pro |

### Your $100 AWS Credit

| Month | Cost | Remaining Credit |
|-------|------|------------------|
| Month 1 | ~$65 | ~$35 left |
| Month 2 | ~$65 | ❌ Credit exhausted (~$30 out of pocket) |

**The $100 credit lasts approximately 5-6 weeks** of full production usage. After that, you pay ~$65/month from your card.

> **Tip:** Apply the credit immediately in AWS Billing → Credits. It applies automatically after that.

### What is Flat Rate vs Pay-Per-Use?

| Service | Type | Meaning |
|---------|----|--------|
| EC2 instance | **FLAT RATE** | Billed hourly whether your app is running or idle. **Stop the instance to stop charges.** |
| EBS disk | **FLAT RATE** | Billed per GB allocated, not per GB used. |
| Data transfer | **PAY-PER-USE** | Only pay for data sent OUT of AWS. Incoming traffic is free. |
| Neon DB | **PAY-PER-USE** | Free tier generously covers small apps. |
| S3 storage | **PAY-PER-USE** | $0.023/GB stored + $0.0004 per 1,000 requests. |

> **To avoid surprise charges:** Set a **Billing Alert** in AWS → Billing → Budgets → Create Budget → $80/month threshold.

### 3rd-Party Services (Not AWS)

These are **separate costs** on top of AWS:

| Service | Cost | Notes |
|---------|------|-------|
| OpenAI API | Pay-per-use | ~$0.002–0.06 per 1K tokens. Budget $20-50/mo for active use. |
| SendGrid | Free / $19.95+ | Free: 100 emails/day. Essentials: 50K/mo for $19.95/mo |
| Twilio | Pay-per-use | SMS ~$0.0079/msg, calls ~$0.013/min |
| Stripe | 2.9% + $0.30 | Per transaction only when users pay you |
| ElevenLabs | Free / $5+ | Free: 10K chars/mo. Starter: $5/mo |
| Sentry | Free | Error tracking, 5K errors/mo free |

---

## � EKS: Sharded IMAP for 500+ Mailboxes (Enterprise)

If you need **true real-time reply detection across 500+ mailboxes**, the single-EC2 "unified mode" will not work. You need **Amazon EKS (Kubernetes)** with a dedicated, horizontally-scaled IMAP worker cluster.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Amazon EKS Cluster                                │
│                                                                             │
│  ┌─────────────┐     ┌────────────────────┐     ┌────────────────────────┐   │
│  │   ALB/NLB   │────▶│  API Gateway Pods  │     │  IMAP Worker Pods      │   │
│  │   (HTTPS)   │     │  (replicas: 3)     │     │  (StatefulSet: 5-20) │   │
│  └─────────────┘     └────────────────────┘     │  • Pod-0: 50 mailboxes │   │
│                                                  │  • Pod-1: 50 mailboxes │   │
│  ┌─────────────┐     ┌────────────────────┐       │  • Pod-N: 50 mailboxes │   │
│  │ ElastiCache │◀───▶│  Outreach Worker   │     └────────────────────────┘   │
│  │  (Redis)    │     │  (replicas: 3)       │                                  │
│  └─────────────┘     └────────────────────┘     ┌────────────────────────┐   │
│                                                  │  Brain Worker Pods     │   │
│  ┌─────────────┐     ┌────────────────────┐      │  (replicas: 2)         │   │
│  │   RDS       │◀───▶│  Other Workers     │      └────────────────────────┘   │
│  │ (Postgres)  │     └────────────────────┘                                  │
│  └─────────────┘                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why This Works

- **Each IMAP pod holds max 50 IDLE connections** (not 500 in one process)
- **Pod crash?** Only 50 mailboxes go dark. Global watchdog detects stale worker in 5 min and reclaims orphans to healthy pods.
- **Need more mailboxes?** KEDA sees orphan list growing → spins up new pods automatically.
- **Memory safe:** Each pod has a 700MB heap guard. If a spam mailbox spikes memory, that pod stops accepting new connections — others unaffected.

### Deploy Steps

#### 1. Create EKS Cluster

```bash
# Install eksctl: https://eksctl.io/installation/
# Install kubectl + aws-cli

eksctl create cluster \
  --name audnix-prod \
  --region us-east-1 \
  --node-type t3.large \
  --nodes 3 --nodes-min 3 --nodes-max 10 \
  --managed
```

#### 2. Install KEDA (for Redis-based autoscaling)

```bash
kubectl apply --server-side -f https://github.com/kedacore/keda/releases/download/v2.15.0/keda-2.15.0.yaml
```

#### 3. Deploy Secrets

```bash
kubectl create namespace audnix
kubectl create secret generic audnix-secrets \
  --from-literal=database-url='postgresql://...' \
  --from-literal=redis-url='rediss://...' \
  --from-literal=redis-password='...' \
  --from-literal=encryption-key='...' \
  --namespace audnix
```

#### 4. Deploy IMAP Worker StatefulSet + KEDA Scaler

```bash
kubectl apply -f k8s/imap-worker-statefulset.yaml -n audnix
kubectl apply -f k8s/imap-worker-keda.yaml -n audnix
```

#### 5. Verify

```bash
# Check pods are running
kubectl get pods -n audnix -l app=audnix-imap-worker

# Check KEDA is scaling
kubectl get scaledobject -n audnix
kubectl get hpa -n audnix

# Check a pod's health
kubectl port-forward pod/audnix-imap-worker-0 3001:3001 -n audnix
curl http://localhost:3001/health
```

### Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `IMAP_DYNAMIC_SHARDING` | `true` | K8s mode: all pods compete via Redis claim |
| `IMAP_MAX_SOCKETS` | `50` | Max IDLE connections per pod |
| `IMAP_MAX_HEAP_MB` | `700` | Memory guard per pod |
| `POD_ORDINAL` | From `metadata.name` | Stable pod identity (`pod-name-0`, `pod-name-1`...) |

### Scaling Math

| Mailboxes | Pods Needed | EKS Nodes | Monthly Cost |
|-----------|-------------|-----------|--------------|
| 250 | 5 | 3 × t3.large | ~$200 |
| 500 | 10 | 5 × t3.large | ~$350 |
| 1,000 | 20 | 8 × t3.large | ~$600 |

*Costs: EKS control plane ($72/mo) + nodes + ElastiCache Redis ($15-50/mo) + RDS Postgres ($15-100/mo).*

### Monitoring

```bash
# Real-time pod metrics
kubectl top pods -n audnix

# IMAP connections per pod
for pod in $(kubectl get pods -n audnix -l app=audnix-imap-worker -o name); do
  echo "=== $pod ==="
  kubectl exec -n audnix $pod -- curl -s localhost:3001/health | jq
  echo
done

# Check Redis orphans (should be 0 in steady state)
kubectl run -it --rm redis-cli --image=redis:7-alpine -- redis-cli -h <redis-host> -a <password> LLEN imap:orphans
```

---

## 🚀 ECS Fargate: Zero-Downtime Worker Migration

For production-grade reliability, migrate all worker services from Railway / single-EC2 to **AWS ECS on Fargate**. This gives you serverless compute, automatic restarts, and rolling deployments with zero downtime.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS Cloud                                        │
│                                                                             │
│  ┌─────────────┐     ┌─────────────────────────────────────────────────┐   │
│  │   Route 53  │────▶│  Application Load Balancer (HTTPS)              │   │
│  └─────────────┘     └─────────────────────────────────────────────────┘   │
│                                    │                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                     Amazon ECS Cluster (Fargate)                      │  │
│  │                                                                     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │  │
│  │  │   API    │ │ Outreach │ │  Brain   │ │  Email   │ │   IMAP   │  │  │
│  │  │ Gateway  │ │ Worker   │ │ Worker   │ │ Worker   │ │ Worker   │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │  │
│  │                                                                     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                        │
│  │ ElastiCache │  │ RDS Postgres│  │ CloudWatch  │                        │
│  │   (Redis)   │  │  (Pooled)   │  │   (Logs)    │                        │
│  └─────────────┘  └─────────────┘  └─────────────┘                        │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐                                         │
│  │     ECR     │◀─│ GitHub Actions│                                         │
│  │  (Images)   │  │   (CI/CD)     │                                         │
│  └─────────────┘  └─────────────┘                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why ECS Fargate?

| Feature | Railway / EC2 | ECS Fargate |
|---------|--------------|-------------|
| **Scaling** | Manual / Script | Target Tracking (CPU/Memory) |
| **Restart** | Crash = downtime | Auto-restart within 30s |
| **Deploy** | SSH + restart | Rolling update, zero downtime |
| **Cost** | $65/mo fixed | Pay per use (~$50-150/mo) |
| **Health** | Process logs | CloudWatch + ALB health checks |

### Infrastructure Prerequisites

Before deploying, create the following AWS resources:

#### 1. VPC & Networking

Create a VPC with public + private subnets across 2+ AZs for ALB + Fargate.

#### 2. ElastiCache Redis (Cluster Mode)

```bash
aws elasticache create-replication-group \
  --replication-group-id audnix-redis \
  --replication-group-description "Audnix Redis cluster" \
  --engine redis \
  --cache-node-type cache.t3.micro \
  --num-cache-clusters 2 \
  --automatic-failover-enabled \
  --multi-az-enabled
```

> Use `rediss://` (TLS) in production. Update `REDIS_URL` with the ElastiCache endpoint.

#### 3. RDS Postgres (Pooled + Direct)

| URL | Purpose | Pool Size |
|-----|---------|-----------|
| `DATABASE_URL_POOL` | Application / Workers | 60 per task |
| `DATABASE_URL_DIRECT` | Migrations / DDL | 5 |

#### 4. Secrets Manager

Store all secrets in **AWS Secrets Manager** (never hardcode in task definitions):

```bash
aws secretsmanager create-secret --name audnix/db-pool-url --secret-string "postgresql://..."
aws secretsmanager create-secret --name audnix/redis-url     --secret-string "rediss://..."
aws secretsmanager create-secret --name audnix/session-secret --secret-string "..."
aws secretsmanager create-secret --name audnix/encryption-key --secret-string "..."
```

#### 5. ECR Repository

```bash
aws ecr create-repository --repository-name audnix-ai --region us-east-1
```

### Task Definition (`aws/ecs/task-definition.json`)

The task definition is parameterized. Replace `${...}` placeholders via `envsubst` or the GitHub Actions workflow before registering.

Key settings for zero-downtime:

| Setting | Value | Why |
|---------|-------|-----|
| `cpu` | `1024` (1 vCPU) | Fargate minimum; scales vertically |
| `memory` | `3072` (3 GB) | Leaves headroom for AI + IMAP buffers |
| `nofile` | `65536` | 500+ mailboxes need many TCP sockets |
| `healthCheck` | `/health` every 30s | ECS waits for 200 OK before routing |
| `awslogs` | CloudWatch | Centralized logging for all workers |
| `secrets` | Secrets Manager | No env var leakage in task def |

Register the task definition:

```bash
# Replace placeholders
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1
export IMAGE_TAG=$(git rev-parse --short HEAD)
export APP_ROLE=imap   # or api, outreach, ai, etc.

envsubst < aws/ecs/task-definition.json > task-def-rendered.json
aws ecs register-task-definition --cli-input-json file://task-def-rendered.json
```

### Service Deployment with Rolling Updates

Create each ECS service with **deployment circuit breaker** and **rolling update**:

```bash
aws ecs create-service \
  --cluster audnix-prod \
  --service-name audnix-imap-worker \
  --task-definition audnix-worker \
  --desired-count 5 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-1,subnet-2],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200,deploymentCircuitBreaker={enable=true,rollback=true}" \
  --health-check-grace-period-seconds 120
```

| Parameter | Value | Effect |
|-----------|-------|--------|
| `minimumHealthyPercent=100` | 100% | New task must be Ready before old task is killed |
| `maximumPercent=200` | 200% | Allows 2x tasks during deploy (e.g., 5 → 10 → 5) |
| `deploymentCircuitBreaker` | `enable=true,rollback=true` | Auto-rollback if new tasks fail health checks |
| `healthCheckGracePeriod` | `120s` | Time to boot before health checks count |

> **This guarantees at least one worker is always processing jobs.**

### Auto-Scaling Policies

Attach target-tracking scaling to every worker service:

```bash
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/audnix-prod/audnix-outreach-worker \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/audnix-prod/audnix-outreach-worker \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name audnix-outreach-memory \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
    '{"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageMemoryUtilization"},"TargetValue":70.0,"ScaleInCooldown":300,"ScaleOutCooldown":60}'

aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/audnix-prod/audnix-outreach-worker \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name audnix-outreach-cpu \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
    '{"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"},"TargetValue":60.0,"ScaleInCooldown":300,"ScaleOutCooldown":60}'
```

| Metric | Target | Scale-Out | Scale-In |
|--------|--------|-----------|----------|
| MemoryUtilization | >70% | 60s | 300s |
| CPUUtilization | >60% | 60s | 300s |

### Graceful Shutdown Behavior

All workers handle `SIGTERM` from ECS:

1. **Pause BullMQ queue** — stop accepting new jobs
2. **Finish current job** — `worker.close(false)` waits for active job completion
3. **Close IMAP/SMTP** — `connectionManager.disconnectAll()` sends IMAP LOGOUT
4. **Deregister from service registry** — Redis cleanup so orphans are reclaimed
5. **Exit 0** — ECS marks task as `STOPPED` cleanly

ECS sends `SIGTERM` first, then `SIGKILL` after the **stopTimeout** (default 30s, configurable up to 120s).

### CI/CD Pipeline (`.github/workflows/ecs-deploy.yml`)

The workflow uses **OIDC** (no long-lived AWS keys):

1. **Build** — multi-stage `Dockerfile.ecs` with layer caching via `gha`
2. **Push** — tag with `git sha` + `latest` to ECR
3. **Redeploy** — `aws ecs update-service --force-new-deployment` for every service
4. **Wait** — `aws ecs wait services-stable` before marking deployment green

Required GitHub repository secrets:

| Secret | Value |
|--------|-------|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::ACCOUNT:role/GitHubActionsECSRoles` |

Required AWS IAM Role (trust policy for GitHub OIDC):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        "StringLike": { "token.actions.githubusercontent.com:sub": "repo:your-org/audnix-ai-project:*" }
      }
    }
  ]
}
```

Role permissions: `AmazonEC2ContainerRegistryFullAccess`, `AmazonECS_FullAccess`, `CloudWatchLogsFullAccess`.

### Verify Deployment

```bash
# Check all services
aws ecs list-services --cluster audnix-prod

# Check task health
aws ecs describe-tasks --cluster audnix-prod --tasks $(aws ecs list-tasks --cluster audnix-prod --query 'taskArns[0]' --output text)

# Tail logs
aws logs tail /ecs/audnix-worker --follow

# Hit health endpoint of a running task
TASK_IP=$(aws ecs describe-tasks ... --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value')
curl http://$TASK_IP:8081/health
```

---

## �� User Capacity

### t3.large (2 vCPU, 8GB RAM) can handle:

| Metric | Estimate | Notes |
|--------|----------|-------|
| **Registered users** | **500–2,000** | Stored in Neon DB, no server limit |
| **Daily active users** | **50–200** | Users actively using the dashboard |
| **Concurrent users** | **20–80** | Users simultaneously in the app |
| **Outreach emails/day** | **2,000–10,000** | Depends on your mailbox config |
| **API requests/min** | **~1,000** | Nginx rate limit: 20 req/s per IP |
| **WebSocket connections** | **~200** | Socket.io real-time connections |

### What determines your limit?

1. **RAM** — Workers and the API share 5GB. Heavy AI processing (many concurrent deals) hits this first.
2. **CPU** — t3.large has 2 vCPUs. CPU-intensive AI inference is throttled by OpenAI's API anyway.
3. **Neon DB connections** — Free tier: 10 concurrent connections. Pro: 100+.
4. **Redis** — 512MB handles thousands of BullMQ jobs easily.

### Scaling Path (when you outgrow t3.large)

| Users | Upgrade To | Monthly Cost |
|-------|------------|-------------|
| 200+ DAU | t3.xlarge (4 vCPU, 16GB) | ~$120/mo |
| 500+ DAU | t3.2xlarge (8 vCPU, 32GB) | ~$240/mo |
| 1000+ DAU | Multiple EC2 + Load Balancer | ~$400+/mo |

---

## File Reference

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Production orchestration (app, nginx, redis) |
| `nginx/nginx-aws.conf` | Reverse proxy with SSL, rate limiting, WebSocket |
| `scripts/aws-setup-server.sh` | One-time server setup |
| `scripts/aws-deploy.sh` | Deploy / update application |
| `scripts/certbot-init.sh` | Initialize SSL certificates |
| `scripts/ssl-renew-cron.sh` | Setup auto-renewal cron |
| `scripts/backup-db.sh` | Database backup to S3 |
| `.github/workflows/aws-deploy.yml` | CI/CD pipeline |
| `.env.aws.example` | Environment variable template |

---

## Support

If something breaks:
1. Check logs: `docker-compose -f docker-compose.prod.yml logs -f app`
2. Check the [Troubleshooting](#troubleshooting) section
3. Restart: `docker-compose -f docker-compose.prod.yml restart`
4. If still stuck, check memory: `docker stats` and `free -h`

---

**You're done! 🎉 Your Audnix AI platform is live on AWS.**
