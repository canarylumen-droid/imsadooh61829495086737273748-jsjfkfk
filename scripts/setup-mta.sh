#!/bin/bash
set -euo pipefail

# =============================================================================
# Audnix AI — KumoMTA Setup Script for AWS Ubuntu EC2
# Run this on a fresh Ubuntu 22.04+ EC2 instance after cloning the repo.
# =============================================================================
# Usage: bash scripts/setup-mta.sh
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }

# ─── Step 1: Install Docker ──────────────────────────────────────────────────
log "Installing Docker..."
sudo apt-get update -qq
sudo apt-get install -y -qq docker.io docker-compose-v2 git nginx certbot python3-certbot-nginx > /dev/null 2>&1
sudo usermod -aG docker ubuntu
log "Docker $(docker --version) installed"

# ─── Step 2: Configure .env ──────────────────────────────────────────────────
if [ ! -f .env ]; then
  warn "No .env file found. Copying from .env.example..."
  cp .env.example .env
  warn "EDIT .env NOW: nano .env"
  warn "Fill in: DATABASE_URL, DATABASE_URL_DIRECT, REDIS_URL, ENCRYPTION_KEY,"
  warn "SESSION_SECRET, GMAIL_CLIENT_ID/SECRET, OUTLOOK_CLIENT_ID/SECRET, etc."
  warn "Then add: NEW_EMAIL_BACKEND=kumomta"
  warn ""
  read -p "Press Enter after editing .env (or Ctrl+C to abort)..."
fi

# ─── Step 3: Push DB schema ─────────────────────────────────────────────────
log "Pushing database schema (creates integration_reputation table)..."
npm run db:push:direct 2>&1 || err "db:push failed — check DATABASE_URL_DIRECT in .env"
log "Schema pushed successfully"

# ─── Step 4: Start KumoMTA + Redis ──────────────────────────────────────────
log "Starting KumoMTA SMTP MTA and Redis..."
docker compose -f docker-compose.mta.yml up -d
log "Waiting for services to be ready..."
sleep 3

# Verify SMTP port is listening
if nc -z 127.0.0.1 2525 2>/dev/null; then
  log "KumoMTA SMTP listener on port 2525 — OK"
else
  warn "Port 2525 not responding. Check: docker compose -f docker-compose.mta.yml logs kumomta"
fi

if nc -z 127.0.0.1 6379 2>/dev/null; then
  log "Redis on port 6379 — OK"
fi

# ─── Step 5: Build and deploy app ────────────────────────────────────────────
log "Building and deploying the app..."
docker compose -f docker-compose.prod.yml up --build -d

log "App deployed. Watching logs (Ctrl+C to stop)..."
docker compose -f docker-compose.prod.yml logs -f app
