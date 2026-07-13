#!/bin/bash
set -e

# ─── Zero-Downtime Deploy — Audnix AI (Docker/Railway) ──────────────────────
# On Railway, just git push triggers auto-deploy. This script is for
# self-hosted Docker deployments where you want rolling updates.
#
# Usage: ./deploy.sh
#
# What it does:
#   1. Build new Docker image
#   2. Run DB migrations in a temporary container
#   3. Gracefully restart services one-by-one (rolling, zero-downtime)
#   4. Broadcast feature flags so UI updates without refresh
# ──────────────────────────────────────────────────────────────────────────────

TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
echo "============================================"
echo "  Audnix Docker Deploy — $TIMESTAMP"
echo "============================================"

# Step 1: Build the new image
echo "[1/4] Building Docker image..."
docker build -t audnix-ai:latest -f Dockerfile.production .

# Step 2: Run DB migrations in a disposable container
echo "[2/4] Running database migrations..."
docker run --rm \
  --env-file .env \
  --network host \
  audnix-ai:latest \
  sh -c "node --import tsx --import ./instrument.ts -e '
    import(\"./shared/lib/db/migrator.js\").then(m => m.runDatabaseMigrations())
    .then(() => { console.log(\"[OK] Migrations complete\"); process.exit(0); })
    .catch(e => { console.error(\"[FAIL]\", e.message); process.exit(1); });
  '"

# Step 3: Gracefully restart services one at a time (rolling update)
echo "[3/4] Rolling restart services..."

SERVICES=(
  "api-gateway"
  "socket-server"
  "email-worker"
  "imap-worker"
  "ai-worker"
  "outreach-worker"
  "lead-recovery-worker"
  "social-worker"
  "billing-worker"
  "orchestrator-worker"
  "rag-worker"
  "vector-db-service"
  "audit-worker"
  "warmup-worker"
)

for service in "${SERVICES[@]}"; do
  echo "  → Restarting $service..."
  docker compose up -d --no-deps --build "$service" 2>/dev/null || \
    docker compose up -d --no-deps "$service"
  sleep 2  # Stagger so database/redis aren't overwhelmed
done

# Step 4: Notify all connected users via feature flags
echo "[4/4] Broadcasting update to connected clients..."
curl -s -X POST http://localhost:5000/api/feature-flags/ping \
  -H "Content-Type: application/json" \
  -d "{\"flags\": {\"deploy\": {\"key\":\"deploy\",\"enabled\":true,\"payload\":{\"timestamp\":\"$TIMESTAMP\"}}}}" \
  > /dev/null 2>&1 || echo "  [WARN] Feature flags broadcast unavailable"

echo ""
echo "============================================"
echo "  Deploy complete! — $TIMESTAMP"
echo "============================================"
docker compose ps
