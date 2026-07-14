#!/bin/bash
# =============================================================================
# Audnix AI — SSL Certificate Auto-Renewal Cron Job
# =============================================================================
# Run this script to add a cron job that renews SSL certificates automatically.
# =============================================================================

set -e

# Determine app directory dynamically (where this script lives, minus /scripts)
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🔧 Setting up SSL auto-renewal cron job..."
echo "   App dir: $APP_DIR"

# Runs at 2:00 AM and 2:00 PM daily (certbot recommends 2x/day)
# Uses --webroot mode (no port conflict with nginx)
# After renewal, sends reload signal (graceful, no dropped connections)
CRON_JOB="0 2,14 * * * cd $APP_DIR && docker compose -f docker-compose.prod.yml run --rm certbot certbot renew --webroot --webroot-path=/var/www/certbot --quiet && docker exec audnix-nginx nginx -s reload 2>&1 | logger -t audnix-ssl-renew"

# Add to crontab (remove old certbot entries first to avoid duplicates)
(crontab -l 2>/dev/null | grep -v "certbot renew" || true; echo "$CRON_JOB") | crontab -

echo "✅ Cron job added!"
echo ""
echo "Current certbot crontab entry:"
crontab -l | grep certbot || echo "   (not found - something went wrong)"
