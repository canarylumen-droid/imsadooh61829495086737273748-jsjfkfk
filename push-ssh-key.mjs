import { EC2InstanceConnectClient, SendSSHPublicKeyCommand } from '@aws-sdk/client-ec2-instance-connect';
import { readFileSync } from 'fs';

const config = JSON.parse(readFileSync('/home/runner/workspace/opencode.json', 'utf8'));
const creds = config.mcp.aws.env;

const client = new EC2InstanceConnectClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: creds.AWS_ACCESS_KEY_ID,
    secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
  }
});

const pubKey = readFileSync('/tmp/opencode_ssh_key.pub', 'utf8').trim();

try {
  const result = await client.send(new SendSSHPublicKeyCommand({
    InstanceId: 'i-0fc13fe518b5f483e',
    InstanceOSUser: 'ubuntu',
    SSHPublicKey: pubKey,
    AvailabilityZone: 'us-east-1d',
  }));
  console.log(JSON.stringify(result));
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}