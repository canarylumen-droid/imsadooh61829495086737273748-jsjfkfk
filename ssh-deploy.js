const { execSync } = require('child_process');
const path = require('path');
const keyPath = path.join(process.env.USERPROFILE, '.ssh', 'audnix-deploy-key-2026-07-05.pem');
const host = 'ubuntu@54.227.164.241';

function run(cmd) {
  console.log(`Running: ${cmd}`);
  try {
    const out = execSync(cmd, { timeout: 60000, encoding: 'utf-8' });
    console.log(out);
    return out;
  } catch(e) {
    console.error(e.stderr || e.message);
    throw e;
  }
}

// Check connection first
console.log('=== Checking connection ===');
try {
  const check = execSync(`ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i "${keyPath}" ${host} "hostname; whoami; uptime"`, { timeout: 30000, encoding: 'utf-8' });
  console.log(check);
} catch(e) {
  console.error('SSH connection failed:', e.stderr || e.message);
  process.exit(1);
}

// pm2 list
console.log('=== PM2 List ===');
run(`ssh -o StrictHostKeyChecking=no -i "${keyPath}" ${host} "pm2 list"`);

// Find git repos
console.log('=== Finding git repos ===');
run(`ssh -o StrictHostKeyChecking=no -i "${keyPath}" ${host} "find /home -name '.git' -type d -maxdepth 4"`);

// Deploy
console.log('=== Deploying ===');
run(`ssh -o StrictHostKeyChecking=no -i "${keyPath}" ${host} "cd /home/ubuntu/audnix-ai-project && git pull origin main && npm install && npm install mysql2 && pm2 restart all"`);

console.log('=== Deployment complete ===');
