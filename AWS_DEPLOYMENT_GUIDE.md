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
11. [Monitoring & Maintenance](#monitoring--maintenance)
12. [Troubleshooting](#troubleshooting)
13. [Architecture](#architecture)

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

## 👥 User Capacity

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
