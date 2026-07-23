#!/usr/bin/env node
// Regenerates /tmp/audnix-ssh-key if missing and pushes to EC2 Instance Connect.
// Run on session start: node scripts/bootstrap-ec2.mjs

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const KEY_PATH = '/tmp/audnix-ssh-key';
const PUB_KEY_PATH = KEY_PATH + '.pub';
const INSTANCE_ID = 'i-0fc13fe518b5f483e';
const HOST = '54.227.164.241';

async function main() {
  if (!existsSync(KEY_PATH)) {
    console.log('🔑 Regenerating SSH key...');
    execSync(`ssh-keygen -t rsa -b 2048 -f ${KEY_PATH} -N "" -q`);
  }

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    console.error('❌ AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars.');
    console.error('   The opencode MCP AWS server provides these when opencode runs them.');
    process.exit(1);
  }

  console.log('📤 Pushing key to EC2 Instance Connect...');
  const { EC2InstanceConnect } = await import('@aws-sdk/client-ec2-instance-connect');
  const { readFileSync } = await import('fs');
  const eic = new EC2InstanceConnect({
    region: 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
  });
  await eic.sendSSHPublicKey({
    InstanceId: INSTANCE_ID,
    InstanceOSUser: 'ubuntu',
    SSHPublicKey: readFileSync(PUB_KEY_PATH, 'utf8').trim(),
  });

  console.log('✅ SSH key ready. Test:');
  console.log(`   ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i ${KEY_PATH} ubuntu@${HOST} "uptime"`);
}

main().catch(e => {
  console.error('❌ Bootstrap failed:', e.message);
  process.exit(1);
});
