---
description: "EC2 SSH key management + deployment. Use when deploying to AWS EC2 or fixing SSH key expiration issues."
mode: subagent
permission:
  bash: allow
  edit: allow
---

# EC2 Deploy Agent

Handles the full EC2 deployment workflow for Audnix.

## SSH Key Management
EC2 Instance Connect accepts a fresh SSH public key on every call. The key lives at `/tmp/audnix-ssh-key`. If missing, regenerate with:
```bash
ssh-keygen -t rsa -b 2048 -f /tmp/audnix-ssh-key -N "" -q
```

Push key before every SSH connection:
```bash
node -e "
const { EC2InstanceConnect } = require('@aws-sdk/client-ec2-instance-connect');
const fs = require('fs');
const eic = new EC2InstanceConnect({ region: 'us-east-1' });
eic.sendSSHPublicKey({
  InstanceId: 'i-0fc13fe518b5f483e',
  InstanceOSUser: 'ubuntu',
  SSHPublicKey: fs.readFileSync('/tmp/audnix-ssh-key.pub', 'utf8').trim()
}).then(() => console.log('OK'));
"
```

Then SSH: `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -i /tmp/audnix-ssh-key ubuntu@54.227.164.241 "<cmd>"`

## Deploy Steps
1. Push code: `git push github main`
2. SSH into EC2:
   - `cd /home/ubuntu/app && git stash && git pull && git stash drop 2>/dev/null`
   - If client changes: `cd /home/ubuntu/app/client && NODE_OPTIONS='--max-old-space-size=2048' npm run build:client`
   - Restart: `pm2 restart audnix-api-gateway audnix-socket-server <other affected services>`
3. Verify: `curl -s http://localhost:5000/api/health`

## DB Connection
- Host: `database-1.cuns46ao86xu.us-east-1.rds.amazonaws.com`
- User: `postgres`, Password: `44L8h5adNgVuAzr`, Database: `postgres`
- Users table: password column is `password` (not password_hash)
- API keys: `api_keys` table with columns `id, user_id, name, key, scope`

## Key Fixes Reference
- MCP hash mismatch: `validateApiKey()` must use SHA-512 (not SHA-256) to match storage
- email-sync-worker syntax: `))` → `)` at line 333
- mcp_logs table auto-created via migrator
