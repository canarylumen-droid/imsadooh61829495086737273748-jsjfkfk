#!/bin/bash
# =============================================================================
# Audnix AI — SSL Certificate Initialization (Let's Encrypt via Webroot)
# =============================================================================
# Usage: ./scripts/certbot-init.sh your-domain.com your-email@example.com
# Must be run AFTER docker-compose.prod.yml is up (nginx must be running)
# =============================================================================

set -e

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "❌ Usage: ./scripts/certbot-init.sh your-domain.com your-email@domain.com"
    exit 1
fi

# Escape domain for safe use in sed (dots are regex metacharacters)
DOMAIN_ESCAPED="${DOMAIN//./\.}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SSL Setup for: $DOMAIN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Verify nginx is running (needed for webroot challenge)
echo "🔍 Checking nginx is running..."
if ! docker compose -f docker-compose.prod.yml ps nginx | grep -q "Up"; then
    echo "❌ Nginx is not running. Start the app first:"
    echo "   ./scripts/aws-deploy.sh"
    exit 1
fi
echo "   ✅ nginx is running"

# Step 2: Verify DNS resolves to this server
echo "🔍 Checking DNS resolution for $DOMAIN..."
SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 icanhazip.com 2>/dev/null)
DOMAIN_IP=$(dig +short "$DOMAIN" A 2>/dev/null | tail -1 || nslookup "$DOMAIN" 2>/dev/null | grep 'Address:' | tail -1 | awk '{print $2}')
if [ -n "$DOMAIN_IP" ] && [ "$SERVER_IP" != "$DOMAIN_IP" ]; then
    echo "   ⚠️  DNS warning: $DOMAIN resolves to $DOMAIN_IP but this server is $SERVER_IP"
    echo "   If DNS is new, wait 5-10 minutes then retry."
    read -p "   Continue anyway? (y/N) " -n 1 -r; echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

# Step 3: Request certificate via WEBROOT (nginx stays running on port 80)
# nginx serves /.well-known/acme-challenge/ from /var/www/certbot (shared volume)
echo "🔒 Requesting SSL certificate via webroot challenge..."
docker compose -f docker-compose.prod.yml run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --agree-tos \
    --no-eff-email \
    --email "$EMAIL" \
    -d "$DOMAIN" \
    --cert-name "$DOMAIN"

echo "   ✅ Certificate obtained!"

# Step 4: Generate ssl.conf from template (replace DOMAIN_PLACEHOLDER safely)
# Using | as sed delimiter to avoid conflicts with forward slashes in paths
echo "📋 Generating nginx SSL config..."
sed "s|DOMAIN_PLACEHOLDER|${DOMAIN}|g" nginx/conf.d/ssl.conf.template > nginx/conf.d/ssl.conf
echo "   ✅ nginx/conf.d/ssl.conf generated"

# Step 5: Reload nginx to pick up the new SSL config
echo "🔄 Reloading nginx with HTTPS config..."
docker exec audnix-nginx nginx -s reload
echo "   ✅ nginx reloaded"

# Step 6: Set up auto-renewal cron
echo "⏰ Setting up SSL auto-renewal cron (2x daily)..."
./scripts/ssl-renew-cron.sh

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ SSL Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  URL:        https://$DOMAIN"
echo "  Cert:       /etc/letsencrypt/live/$DOMAIN/"
echo "  Config:     nginx/conf.d/ssl.conf"
echo "  Auto-renew: 2x daily via cron"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
