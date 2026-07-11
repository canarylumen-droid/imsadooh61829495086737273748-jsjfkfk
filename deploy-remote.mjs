import { EC2InstanceConnectClient, SendSSHPublicKeyCommand } from "@aws-sdk/client-ec2-instance-connect";
import { execSync } from "child_process";

import { readFileSync } from "fs";
const pubKey = readFileSync(
  "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\deploy-temp-key.pub",
  "utf8"
).trim();
const keyFile = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\deploy-temp-key";
const PROJECT_DIR = "/home/ubuntu/app";

async function pushKey() {
  const client = new EC2InstanceConnectClient({ region: "us-east-1" });
  await client.send(new SendSSHPublicKeyCommand({
    InstanceId: "i-0fc13fe518b5f483e",
    InstanceOSUser: "ubuntu",
    SSHPublicKey: pubKey,
    AvailabilityZone: "us-east-1d",
  }));
}

async function runSSH(cmd, timeout = 60000) {
  await pushKey();
  await new Promise(r => setTimeout(r, 1500));
  const ssh = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o IdentitiesOnly=yes -i ${keyFile} ubuntu@54.227.164.241`;
  return execSync(`${ssh} "${cmd}"`, { timeout, shell: "cmd.exe", maxBuffer: 10 * 1024 * 1024 }).toString();
}

async function main() {
  console.log("[1] Restarting PM2...");
  const restartResult = await runSSH(`cd ${PROJECT_DIR} && pm2 restart all 2>&1`, 60000);
  console.log(restartResult);

  console.log("[2] PM2 status...");
  const statusResult = await runSSH(`cd ${PROJECT_DIR} && pm2 status 2>&1 | head -20`, 15000);
  console.log(statusResult);

  console.log("[3] Done!");
}

main().catch(e => { console.error("Failed:", e.message); process.exit(1); });
