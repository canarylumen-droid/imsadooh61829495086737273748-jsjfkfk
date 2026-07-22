# Deployment Guide

## Infrastructure

### EC2 Instance
- **Instance**: `i-0fc13fe518b5f483e`
- **IP**: 54.227.164.241
- **AZ**: us-east-1d
- **OS**: Ubuntu (latest LTS)
- **RAM**: TBD (monitored via PM2 host metrics)
- **App directory**: `/home/ubuntu/app`

### Storage
- **S3 Bucket**: `audnix-app-uploads` (us-east-1)
- **Client deploy**: Static files → S3 (or local dist/ folder)
- **Uploads**: S3 pre-signed URLs (1-year expiry) via `getPublicUrl()`

### Database
- **RDS**: MySQL 8 (Aurora-compatible)
- **Connection**: `mysql2` lazy import with pool
- **Session store**: PostgreSQL `user_sessions` (connect-pg-simple)

### Redis
- Docker Redis with password `devpassword`
- Used for: BullMQ queues, pub/sub cluster events, Rust interop queues
- `REDIS_URL` explicitly set in all PM2 env blocks

## PM2 Services (18 Total)

### Management Commands
```bash
# View all services
pm2 status

# View logs for specific service
pm2 logs audnix-api-gateway --lines 50 --nostream

# Restart specific service
pm2 restart audnix-api-gateway

# Restart all services
pm2 restart all

# Delete and re-create (for env var changes)
pm2 delete audnix-worker-imap
pm2 start ecosystem.config.cjs --only audnix-worker-imap
```

### Environment Variables
- PM2 env blocks in `ecosystem.config.cjs` override `.env`
- `--update-env` flag required when restarting after env changes
- `pm2 set` module config overrides BOTH ecosystem file AND .env
  - To clear module config: `pm2 delete <service>` then `pm2 start`
  - `pm2 set <service>:KEY null` stores literal string `"null"` — bug-prone

## Deployment Process

### Standard Deploy
```bash
# 1. Push to GitHub
git push github main

# 2. SSH into EC2
ssh -i /tmp/aws_temp_key ubuntu@54.227.164.241

# 3. Pull and build
cd /home/ubuntu/app
git stash -- package.json package-lock.json 2>/dev/null
git pull

# 4. Build client
cd /home/ubuntu/app/client
NODE_OPTIONS='--max-old-space-size=2048' npm run build:client

# 5. Build Rust services (if changed)
cd /home/ubuntu/app/rust-email-sender && cargo build --release
cd /home/ubuntu/app/rust-imap-worker && cargo build --release

# 6. Restart affected services
pm2 restart audnix-api-gateway audnix-socket-server
# Or for full deploy:
pm2 restart all
```

### SSH Key Management
```bash
# Via EC2 Instance Connect (temp key)
node -e "
const { EC2InstanceConnectClient, SendSSHPublicKeyCommand }
  = require('@aws-sdk/client-ec2-instance-connect');
const pubkey = fs.readFileSync('/tmp/aws_temp_key.pub', 'utf8').trim();
const client = new EC2InstanceConnectClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'AKIAZUAXW67WM4BNID4G',
    secretAccessKey: '<secret>'
  }
});
client.send(new SendSSHPublicKeyCommand({
  InstanceId: 'i-0fc13fe518b5f483e',
  InstanceOSUser: 'ubuntu',
  SSHPublicKey: pubkey,
  AvailabilityZone: 'us-east-1d'
}));
"
```

### Client Build Notes
- `vite.config.ts` is at project ROOT (not in `client/`)
- Build command runs from root: `npx vite build`
- Output: `dist/public/`
- `--max-old-space-size=2048` needed for memory-constrained instances

## CI/CD Pipeline

### GitHub Workflows
| Workflow | Trigger | Action |
|---|---|---|
| `ci.yml` | Push to main | `npm ci` → `npm audit` (non-blocking) → `npm run check` → `npm run build:client` |
| `aws-deploy.yml` | CI success | SSH into EC2 → git pull → build → restart |
| `codeql.yml` | Push to main | CodeQL analysis (12 alerts open) |

### CI Details
- `npm audit`: 15+ vulnerabilities (mostly `request` / `google-it` — no fix path)
- Rust CI in `ci.yml`: compiles `rust-email-sender` + `rust-imap-worker`
- Deploy workflow: `.github/workflows/deploy-ec2.yml`

## Monitoring

### PM2 Logs
```bash
# All services
pm2 logs --lines 50 --nostream

# Specific service
pm2 logs audnix-worker-imap --lines 50 --nostream

# Error log
cat ~/.pm2/logs/audnix-worker-imap-error.log | tail -50

# Out log
cat ~/.pm2/logs/audnix-worker-imap-out.log | tail -50
```

### Redis Health
```bash
# Check queue depths
redis-cli -a devpassword LLEN email-send-queue
redis-cli -a devpassword LLEN mx-batch-queue

# Check circuit breaker state
redis-cli -a devpassword keys "imap:circuit:*"

# Check active IMAP connections
redis-cli -a devpassword keys "imap:active:*"

# Check locks
redis-cli -a devpassword keys "lock:imap:conn:*"

# Clear stale state (debugging)
redis-cli -a devpassword DEL imap:circuit:admin.mail.example.com
redis-cli -a devpassword KEYS "imap:active:*" | xargs redis-cli -a devpassword DEL
```

### MySQL Health
```bash
# Connection pool
mysql -h <host> -u <user> -p -e "SHOW STATUS LIKE 'Threads_connected';"

# Query performance
mysql -h <host> -u <user> -p -e "SHOW FULL PROCESSLIST;"

# Table sizes
mysql -h <host> -u <user> -p -e "
  SELECT table_name, ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
  FROM information_schema.tables
  WHERE table_schema = 'audnix'
  ORDER BY size_mb DESC;"
```

## Troubleshooting Guide

### "Service won't start"
```bash
# Check PM2 logs
pm2 logs <service> --lines 50 --nostream

# Check if port is in use
sudo lsof -i :3001
sudo lsof -i :3002

# Check env vars
pm2 show <service> | grep -i env

# Kill and restart
pm2 delete <service>
pm2 start ecosystem.config.cjs --only <service>
```

### "Client build fails"
```bash
# Clear cache
rm -rf client/node_modules/.vite

# Increase memory
NODE_OPTIONS='--max-old-space-size=4096' npx vite build

# Check TS errors
npx tsc --noEmit 2>&1 | head -50
```

### "IMAP connections failing (AUTH_FAILED)"
1. Check encryption key: `pm2 show audnix-worker-imap | grep ENCRYPTION_KEY`
2. Check encrypted password in DB: `SELECT LEFT(credentials, 50) FROM integrations WHERE type='custom_email'`
3. Clear stale Redis state: `redis-cli KEYS "imap:circuit:*" | xargs redis-cli DEL`
4. Restart worker: `pm2 restart audnix-worker-imap --update-env`

### "Socket.IO not connecting"
1. Check socket server: `pm2 status audnix-socket-server`
2. Check nginx WebSocket config (upgrade headers)
3. Check client URL: `VITE_WS_URL=http://localhost:3002` (dev)
4. Check CSP: `connect-src` includes WebSocket URL

### "KPIs not updating in real-time"
1. Check cluster events: `redis-cli SUBSCRIBE audnix-cluster:events`
2. Check for `STATS_CACHE_INVALIDATE` handling errors
3. Check cache TTL: `dashboard-routes.ts` (500ms)
4. Check `pendingInvalidations` map
5. Verify worker is firing `clusterSync.notifyStatsUpdated()`

### "Redis connection refused"
1. Check Docker: `docker ps | grep redis`
2. Check password: `redis-cli -a <password> PING`
3. Check env: `echo $REDIS_URL`
4. Check PM2 env: `pm2 show audnix-api-gateway | grep REDIS`

## Known Issues & Workarounds

### Encryption Key Crisis (Jul 17)
- IMAP worker used `ENCRYPTION_KEY: '491bd6e2...'` from ecosystem.config.cjs env block
- `.env` had `ENCRYPTION_KEY: 'd5def3c9...'` (different key)
- NEITHER key decrypts 5 existing IMAP integrations — original key lost
- **Fix**: Removed ENCRYPTION_KEY from ecosystem.config.cjs IMAP block
- **Current**: `.env` key `d5def3c9...` is the active key
- **Impact**: New integrations work; existing 5 need manual credential re-entry

### PM2 Env Override Order
1. `.env` file (loaded by dotenv if app loads it)
2. `ecosystem.config.cjs` env block (overrides .env)
3. `pm2 set` module config (overrides ALL — persists across restarts)
4. Only `pm2 delete` + `pm2 start` fully clears module config
5. `pm2 set <service>:KEY null` stores literal string `"null"` — not helpful

### Node.js Workers Missing dotenv
- Some worker entry points do NOT load dotenv
- Relies entirely on PM2 env block for critical vars (ENCRYPTION_KEY, REDIS_URL)
- All 16 workers have explicit `REDIS_URL` in PM2 env blocks (Jul 15 fix)

### RE: IMAP Worker and Gmail/Outlook
- Custom email IMAP: handled by Rust (rust-imap-worker)
- Gmail/Outlook OAuth IMAP: handled by Node.js (worker-imap)
- Two separate codebases for IMAP monitoring
- Rust worker recompiled on EC2 with `cargo build --release`

### RE: node_modules on EC2
- `package-lock.json` had stale `package-firewall.replit.local` URLs
- Fix: `sed 's|package-firewall.replit.local|registry.npmjs.org|g' package-lock.json`
- Then: `npm ci --prefer-offline --no-audit --no-fund`
- 1421 packages restored from 1.1GB cache (36s)
