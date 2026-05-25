#!/bin/bash
# =============================================================================
# Audnix AI — AWS EC2 Server Setup (One-time)
# =============================================================================
# Run this ONCE on a fresh Ubuntu 24.04 EC2 instance
# =============================================================================

set -e

APP_DIR="$(pwd)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Audnix AI — AWS EC2 Server Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Update system
echo "🔄 Updating system packages..."
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
echo "🐳 Installing Docker..."
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose
echo "🐳 Installing Docker Compose..."
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install utilities
echo "📦 Installing utilities..."
sudo apt-get install -y git curl htop dnsutils unzip jq

# Enable Docker on boot
echo "⚙️  Enabling Docker service..."
sudo systemctl enable docker
sudo systemctl start docker

# Create required directories
echo "📁 Creating required directories..."
mkdir -p nginx/conf.d uploads logs

# Set up swap (important for t3.large with 8GB RAM)
echo "💾 Setting up 4GB swap file..."
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make swap permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker daemon optimization for single-server
echo "⚙️  Configuring Docker daemon..."
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json > /dev/null <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "live-restore": true
}
EOF

sudo systemctl restart docker

# Create .env file template if it doesn't exist
if [ ! -f ".env" ]; then
echo "📝 Creating .env template from .env.aws.example..."
if [ -f ".env.aws.example" ]; then
    cp .env.aws.example .env
    echo "   ✅ .env created from .env.aws.example"
else
    # Fallback minimal template if .env.aws.example is missing
    cat > ".env" <<'EOF'
NODE_ENV=production
PORT=5000
APP_URL=https://your-domain.com
DATABASE_URL=postgresql://user:password@neon-host.neon.tech/audnix?sslmode=require
REDIS_URL=rediss://default:your-redis-password@your-host.upstash.io:6380
SESSION_SECRET=change-this-to-a-64-char-random-string-minimum-length-required
ENCRYPTION_KEY=change-this-to-a-32-char-random-string-for-aes-256
VITE_ADMIN_SECRET_URL=your-secret-admin-path
ADMIN_SECRET_KEY=your-admin-secret-key
ADMIN_WHITELIST_EMAILS=admin@your-domain.com
OPENAI_API_KEY=sk-your-openai-key
GEMINI_API_KEY=your-gemini-key
ZAI_API_KEY=your-zai-key
Z_AI_API_KEY=your-zai-key
TWILIO_SENDGRID_API_KEY=SG.your-sendgrid-key
TWILIO_EMAIL_FROM=noreply@your-domain.com
RESEND_API_KEY=re_your-resend-key
STRIPE_SECRET_KEY=sk_live_your-stripe-secret
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret
STRIPE_PUBLISHABLE_KEY=pk_live_your-publishable-key
STRIPE_STARTER_PRICE_ID=price_your-starter-id
STRIPE_PRO_PRICE_ID=price_your-pro-id
STRIPE_ENTERPRISE_PRICE_ID=price_your-enterprise-id
GMAIL_CLIENT_ID=your-google-client-id
GMAIL_CLIENT_SECRET=your-google-client-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
OUTLOOK_CLIENT_ID=your-outlook-client-id
OUTLOOK_CLIENT_SECRET=your-outlook-client-secret
OUTLOOK_TENANT_ID=common
META_APP_ID=your-meta-app-id
META_APP_SECRET=your-meta-app-secret
META_REDIRECT_URI=https://your-domain.com/api/oauth/instagram/callback
META_VERIFY_TOKEN=your-meta-verify-token
CALENDLY_CLIENT_ID=your-calendly-client-id
CALENDLY_CLIENT_SECRET=your-calendly-client-secret
CALENDLY_WEBHOOK_SECRET=your-calendly-webhook-secret
S3_ACCESS_KEY_ID=your-s3-access-key-id
S3_SECRET_ACCESS_KEY=your-s3-secret-access-key
S3_BUCKET_NAME=your-s3-bucket
S3_REGION=us-east-1
ELEVENLABS_API_KEY=your-elevenlabs-key
OBSERVABILITY_SENTRY_DSN=https://your-sentry-dsn
LOG_LEVEL=info
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
UNIFIED_MODE=true
AI_WORKER_PORT=8082
EMAIL_WORKER_PORT=8081
OUTREACH_WORKER_PORT=8083
BILLING_WORKER_PORT=8085
LEAD_RECOVERY_WORKER_PORT=8095
EOF
fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Server Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Next Steps:"
echo "  1. Edit .env file with your real secrets:"
echo "     nano .env"
echo ""
echo "  2. Deploy the application:"
echo "     ./scripts/aws-deploy.sh"
echo ""
echo "  3. Setup SSL (after DNS points to this server):"
echo "     ./scripts/certbot-init.sh your-domain.com your-email@domain.com"
echo ""
echo "  Swap:     $(free -h | grep Swap | awk '{print $2}') configured"
echo "  Docker:   $(docker --version)"
echo "  Compose:  $(docker-compose --version)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
