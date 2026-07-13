# Nginx + PM2 Deployment Guide for AWS EC2

This guide shows how to deploy your application with nginx serving the frontend independently and PM2 managing backend microservices. This architecture ensures the frontend remains available even if the API gateway crashes.

## Architecture

```
User → Nginx (port 80/443)
       ├→ Frontend static files (dist/public)
       ├→ /api/* → API Gateway (port 5000)
       └→ /socket.io/* → Socket Server (port 5001)

Backend Microservices (PM2):
- API Gateway (port 5000) - API routes only, no static files
- Socket Server (port 5001)
- 14 other workers (email, AI, outreach, etc.)
```

## Benefits

- **Frontend independence:** If API gateway crashes, frontend still loads
- **Better performance:** Nginx serves static files efficiently
- **Graceful degradation:** Frontend can show error messages when backend is down
- **Separation of concerns:** Nginx handles web serving, PM2 handles process management

## Prerequisites

- AWS EC2 instance (Ubuntu 20.04/22.04 or Amazon Linux 2/2023)
- Node.js 22.x installed
- Redis installed (see `docs/redis-setup-guide.md`)
- PostgreSQL (Neon or self-hosted)

## Installation Steps

### 1. Install Nginx

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install nginx -y
sudo systemctl enable nginx
sudo systemctl start nginx
```

**Amazon Linux:**
```bash
sudo yum install nginx -y
# OR for Amazon Linux 2023
sudo dnf install nginx -y
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 2. Deploy Your Application

```bash
# Clone your repository
git clone https://github.com/canarylumen-droid/imsadooh61829495086737273748-jsjfkfk.git
cd imsadooh61829495086737273748-jsjfkfk

# Install dependencies
npm install

# Build frontend
npm run build:client

# Set up environment variables
cp .env.example .env
nano .env  # Add your actual values
```

### 3. Copy Nginx Configuration

```bash
# Copy nginx.conf to nginx directory
sudo cp nginx.conf /etc/nginx/nginx.conf

# Test nginx configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 4. Start Backend Services with PM2

```bash
# Install PM2 globally (if not already installed)
sudo npm install -g pm2

# Start all microservices
npm run start:pm2:production

# Save PM2 process list
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the instructions output by the command
```

### 5. Configure Firewall

```bash
# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow SSH (if not already allowed)
sudo ufw allow 22/tcp

# Enable firewall
sudo ufw enable
```

### 6. Verify Deployment

```bash
# Check nginx status
sudo systemctl status nginx

# Check PM2 status
pm2 list

# Check API gateway logs
pm2 logs audnix-api-gateway

# Test frontend
curl http://localhost

# Test API
curl http://localhost/api/health
```

## Environment Variables

Make sure your `.env` file includes:

```bash
NODE_ENV=production
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
SESSION_SECRET=your-64-char-secret
ENCRYPTION_KEY=your-32-char-key
OPENAI_API_KEY=sk-...
# ... other required variables
```

## Nginx Configuration Details

The nginx configuration (`nginx.conf`) handles:

1. **Static file serving:** Serves frontend from `/app/dist/public`
2. **API proxy:** Proxies `/api/*` to API gateway on port 5000
3. **WebSocket proxy:** Proxies `/socket.io/*` to socket server on port 5001
4. **Caching:** Static assets cached for 1 year, index.html not cached
5. **Security headers:** CSP, XSS protection, frame options
6. **Gzip compression:** Enabled for text-based assets
7. **Rate limiting:** 10 requests/second per IP

## PM2 Configuration

The `ecosystem.config.js` includes:

- **API Gateway:** Runs with `DISABLE_STATIC_SERVE=true` (no static files)
- **16 microservices:** All backend workers managed by PM2
- **Auto-restart:** Services restart on crash
- **Logging:** All logs saved to `./logs/` directory
- **Memory limits:** Each service has max memory limits

## Troubleshooting

### Frontend not loading:

```bash
# Check if dist/public exists
ls -la dist/public/

# Check nginx error logs
sudo tail -f /var/log/nginx/error.log

# Check nginx is running
sudo systemctl status nginx

# Verify nginx config
sudo nginx -t
```

### API not working:

```bash
# Check PM2 status
pm2 list

# Check API gateway logs
pm2 logs audnix-api-gateway

# Restart API gateway
pm2 restart audnix-api-gateway

# Check if port 5000 is listening
sudo netstat -tlnp | grep 5000
```

### Redis connection issues:

```bash
# Check Redis status
sudo systemctl status redis-server

# Test Redis connection
redis-cli ping

# Check Redis logs
sudo tail -f /var/log/redis/redis-server.log
```

### PM2 services not starting:

```bash
# Check PM2 logs
pm2 logs

# Restart all services
pm2 restart all

# Clear PM2 logs
pm2 flush

# Rebuild and restart
pm2 delete all
npm run start:pm2:production
```

## Updating the Application

When you deploy changes:

```bash
# Pull latest code
git pull

# Install new dependencies
npm install

# Rebuild frontend
npm run build:client

# Restart PM2 services
pm2 restart all

# Reload nginx (if config changed)
sudo systemctl reload nginx
```

## Monitoring

### View PM2 monitoring:
```bash
pm2 monit
```

### View logs:
```bash
pm2 logs
```

### Check service status:
```bash
pm2 list
pm2 info audnix-api-gateway
```

### Nginx access logs:
```bash
sudo tail -f /var/log/nginx/access.log
```

## SSL/HTTPS Setup (Recommended)

For production, use Let's Encrypt for free SSL:

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal is configured automatically
```

## Scaling

For higher traffic:

1. **Increase PM2 instances:** Edit `ecosystem.config.js` and change `instances: 1` to `instances: 2` or more
2. **Use cluster mode:** Change `exec_mode: 'fork'` to `exec_mode: 'cluster'`
3. **Add load balancer:** Use AWS ALB in front of multiple EC2 instances
4. **Use Redis Cluster:** For high-availability Redis

## Security Checklist

- [ ] Set strong SESSION_SECRET and ENCRYPTION_KEY
- [ ] Use HTTPS (SSL certificate)
- [ ] Configure firewall rules
- [ ] Disable root SSH login
- [ ] Use SSH keys instead of passwords
- [ ] Keep system updated: `sudo apt update && sudo apt upgrade`
- [ ] Monitor logs regularly
- [ ] Set up backups for database
- [ ] Use environment variables for secrets (never commit to git)
