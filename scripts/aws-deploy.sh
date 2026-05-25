#!/bin/bash
# =============================================================================
# Audnix AI — AWS Production Deployment Script
# =============================================================================
# Usage: ./scripts/aws-deploy.sh
# Must be run from the project root directory on the EC2 server
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

COMPOSE_FILE="docker-compose.prod.yml"
APP_NAME="audnix"

echo -e "${BLUE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Audnix AI — Production Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"

# Check prerequisites
echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"

if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo "   Create it first: cp .env.aws.example .env && nano .env"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found! Run ./scripts/aws-setup-server.sh first${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose not found!${NC}"
    exit 1
fi

# Check critical env vars
echo -e "${YELLOW}🔍 Validating environment variables...${NC}"
REQUIRED_VARS=("DATABASE_URL" "REDIS_URL" "SESSION_SECRET" "ENCRYPTION_KEY" "APP_URL" "OPENAI_API_KEY" "TWILIO_SENDGRID_API_KEY" "STRIPE_SECRET_KEY" "META_APP_ID" "S3_ACCESS_KEY_ID")
MISSING=0
for var in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "^$var=" .env || grep "^$var=" .env | grep -q "change-this"; then
        echo -e "${RED}   ⚠️  $var is missing or using placeholder value${NC}"
        MISSING=1
    fi
done

if [ $MISSING -eq 1 ]; then
    echo -e "${RED}❌ Please fix missing environment variables in .env${NC}"
    exit 1
fi

echo -e "${GREEN}   ✅ All required environment variables set${NC}"

# Pull latest code (if running from git repo)
if [ -d ".git" ]; then
    echo -e "${YELLOW}📥 Pulling latest code...${NC}"
    git pull origin main
fi

# Stop existing containers gracefully
echo -e "${YELLOW}🛑 Stopping existing containers...${NC}"
docker-compose -f "$COMPOSE_FILE" down --timeout 30 || true

# Remove dangling images only (not volumes — avoids wiping Redis data)
echo -e "${YELLOW}🧹 Cleaning dangling images...${NC}"
docker image prune -f

# Build and start
# Pass --no-cache flag manually only when needed: ./scripts/aws-deploy.sh --no-cache
BUILD_FLAGS=""
if [[ "$*" == *"--no-cache"* ]]; then
    BUILD_FLAGS="--no-cache"
    echo -e "${YELLOW}🔨 Building containers (no cache)...${NC}"
else
    echo -e "${YELLOW}🔨 Building containers (with cache for speed)...${NC}"
fi

docker-compose -f "$COMPOSE_FILE" build $BUILD_FLAGS
docker-compose -f "$COMPOSE_FILE" up -d

# Wait for healthcheck
echo -e "${YELLOW}⏳ Waiting for app to be healthy (up to 2 minutes)...${NC}"
for i in {1..24}; do
    if docker-compose -f "$COMPOSE_FILE" ps | grep -q "healthy"; then
        echo -e "${GREEN}   ✅ App is healthy!${NC}"
        break
    fi
    sleep 5
    echo -e "${BLUE}   ...still starting ($((i*5))s)${NC}"
done

# Verify services
echo -e "${YELLOW}🔍 Verifying services...${NC}"
APP_CONTAINER=$(docker-compose -f "$COMPOSE_FILE" ps -q app)
if [ -n "$APP_CONTAINER" ]; then
    echo -e "${GREEN}   ✅ App container running: ${APP_CONTAINER:0:12}${NC}"
else
    echo -e "${RED}   ❌ App container failed to start${NC}"
    exit 1
fi

NGINX_CONTAINER=$(docker-compose -f "$COMPOSE_FILE" ps -q nginx)
if [ -n "$NGINX_CONTAINER" ]; then
    echo -e "${GREEN}   ✅ Nginx container running: ${NGINX_CONTAINER:0:12}${NC}"
else
    echo -e "${YELLOW}   ⚠️  Nginx container not yet running (may still be waiting for app healthcheck)${NC}"
fi
# Note: Redis is EXTERNAL (Upstash/Redis Cloud) — no container to check

# Check API health
echo -e "${YELLOW}🌐 Checking API health...${NC}"
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/health || echo "000")
if [ "$HEALTH_STATUS" = "200" ]; then
    echo -e "${GREEN}   ✅ API health check passed (HTTP 200)${NC}"
else
    echo -e "${RED}   ⚠️  API health check returned HTTP $HEALTH_STATUS${NC}"
    echo "      Check logs: docker-compose -f $COMPOSE_FILE logs -f app"
fi

# Print status
echo ""
echo -e "${GREEN}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"
echo ""
echo "  Containers:"
docker-compose -f "$COMPOSE_FILE" ps

echo ""
echo "  Resources:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" $(docker-compose -f "$COMPOSE_FILE" ps -q)

echo ""
echo "  Useful Commands:"
echo "    View logs:     docker-compose -f $COMPOSE_FILE logs -f app"
echo "    Restart app:   docker-compose -f $COMPOSE_FILE restart app"
echo "    Shell access:  docker-compose -f $COMPOSE_FILE exec app sh"
echo "    Stop all:      docker-compose -f $COMPOSE_FILE down"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
