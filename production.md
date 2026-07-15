# Production Test Results

**Date:** 2026-07-15  
**Environment:** AWS EC2 (t3.large) + RDS PostgreSQL + nginx reverse proxy  
**Node:** v22.23.1 | **PM2:** 16 services online  
**User tested:** `team.replyflow@gmail.com` (enterprise, member)

---

## 1. Server Status

| Check | Result |
|-------|--------|
| `/health` | `{"status":"ok","mode":"starting"}` |
| PM2 Services | **16/16 online** (no crash loops) |
| Port 5000 (API) | Listening |
| Port 5001 (Socket) | Listening |
| Port 80 (nginx) | Serving client build |
| DB Connection | RDS PostgreSQL (3 users, 366 leads, 357 messages) |

---

## 2. Auth Flow

| Endpoint | Result |
|----------|--------|
| `POST /api/user/auth/login` | ✅ Valid creds → `success: true` |
| `POST /api/user/auth/login` | ❌ Invalid creds → `401 Invalid email or password` |
| Session | Express-session (cookie-based), no Set-Cookie observed on localhost (may require proxy headers) |
| API Key (Bearer) | ✅ Works for `requireAuthOrApiKey` endpoints |
| API Key (x-api-key) | ✅ Works for `requireAuthOrApiKey` endpoints |

---

## 3. API Endpoints

| Endpoint | Auth Method | Result | Notes |
|----------|------------|--------|-------|
| `GET /api/dashboard/stats` | API Key | ✅ | Returns stats object |
| `GET /api/dashboard/user` | API Key | ✅ | Returns user profile |
| `GET /api/prospecting/leads` | API Key | ✅ | 184 leads for user |
| `GET /api/outreach/campaigns` | API Key | ✅ | Campaigns returned |
| `GET /api/integrations` | API Key | ✅ | 4 integrations returned |
| `GET /api/developer/api-keys` | Session | ❌ | Requires session auth |
| `GET /api/mcp/key/current` | Session | ❌ | Requires session auth |
| `POST /api/mcp/test` | Session | ❌ | Requires session auth |
| `GET /api/messages/:leadId` | API Key | ✅ | Messages returned |
| `POST /api/ai/draft-reply/:leadId` | API Key | ✅ | Draft generated |
| `GET /api/notifications` | API Key | ✅ | Works |
| `GET /api/user-settings` | API Key | ✅ | Works |
| `GET /api/sse/health` | Public | ✅ | Uptime reported |
| `POST /api/user/auth/forgot-password` | Public | ❌ | 500 error needs debugging |
| `POST /api/user/auth/signup` | Public | ❌ | 404 (route may differ) |

---

## 4. Client Build

| Check | Result |
|-------|--------|
| Vite Build | ✅ Built in 54.11s |
| `dist/public/index.html` | ✅ 18KB |
| Assets | ✅ JS chunks generated |
| nginx serves | ✅ HTTP 200, HTML loads correctly |

---

## 5. WebSocket

| Check | Result |
|-------|--------|
| Socket server port | ✅ 5001 listening |
| `/health` endpoint | ✅ Returns uptime |
| WS connection | ❌ Handshake fails (may need auth header) |
| Redis pub/sub | ⚠️ Infra-scaler reports REDIS_URL not configured |

---

## 6. Database

| Metric | Total | User `team.replyflow` |
|--------|-------|----------------------|
| Users | 3 | - |
| Leads | 366 | 184 |
| Messages | 357 | 357 |
| Integrations | 7 | 4 |
| API Keys | 1 | 1 |

Integrations for `team.replyflow`:
- `custom_email` - ruben@network.replyflow.pro (connected)
- Plus 3 others

---

## 7. Known Issues

1. **Session cookies not sent on localhost** — express-session may require `trust proxy` for localhost requests. Works through nginx.
2. **Redis not configured** — REDIS_URL missing, infra-scaler logs errors every 30s. WebSocket offline buffer not available.
3. **Signup/forgot-password endpoints need attention** — 404/500 responses.
4. **npm install fails on server** — Replit package firewall (EAI_AGAIN) prevents installing new packages. Must SCP node_modules when needed.
5. **`/api/ai/insights` returns 404** — Route may be mounted under different prefix.
6. **`/api/channel-status/all` returns 404** — Route may be mounted under different prefix.

---

## 8. Quick Commands

```bash
# SSH into production
# (uses EC2 Instance Connect, no persistent PEM)
aws ec2-instance-connect send-ssh-public-key \
  --region us-east-1 \
  --instance-id i-0fc13fe518b5f483e \
  --instance-os-user ubuntu \
  --ssh-public-key file:///tmp/audnix-ssh-key.pub
ssh -i /tmp/audnix-ssh-key ubuntu@54.227.164.241

# PM2 management
pm2 list                          # All services
pm2 logs audnix-api-gateway       # API logs
pm2 restart all --update-env      # Restart all
pm2 save                          # Save process list

# Build client
cd /home/ubuntu/app
npx vite build                    # Client build (needs react-icons@5.7.0+)

# Check services
ss -tlnp | grep -E "5000|5001"    # Ports
curl localhost:5000/health        # API health
curl localhost/                   # nginx
```
