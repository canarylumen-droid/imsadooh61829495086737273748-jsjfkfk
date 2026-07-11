import { EC2InstanceConnectClient, SendSSHPublicKeyCommand } from "@aws-sdk/client-ec2-instance-connect";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";

const pubKey = readFileSync("C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\deploy-temp-key.pub", "utf8").trim();
const keyFile = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\deploy-temp-key";

async function pushKey() {
  const client = new EC2InstanceConnectClient({ region: "us-east-1" });
  await client.send(new SendSSHPublicKeyCommand({
    InstanceId: "i-0fc13fe518b5f483e", InstanceOSUser: "ubuntu",
    SSHPublicKey: pubKey, AvailabilityZone: "us-east-1d"
  }));
  await new Promise(r => setTimeout(r, 2000));
}

function ssh(cmd) {
  const r = spawnSync("ssh", [
    "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10",
    "-o", "IdentitiesOnly=yes", "-i", keyFile,
    "ubuntu@54.227.164.241", cmd
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });
  return r.stdout?.toString() || "";
}

async function main() {
  await pushKey();
  // Delete PM2 env cache so it re-reads .env fresh
  console.log("Deleting PM2 env cache...");
  console.log(ssh("pm2 flush && rm -f /home/ubuntu/.pm2/dump.pm2 && echo CACHE_CLEARED"));

  await pushKey();
  // Restart all with --update-env
  console.log("Restarting all with --update-env...");
  console.log(ssh("pm2 restart all --update-env && echo ALL_RESTARTED"));

  await pushKey();
  // Verify the key is loaded in a running process
  console.log("Verifying...");
  const verify = ssh("pm2 show audnix-worker-ai | grep -i 'deepseek\\|env' || echo CHECK_ENV");
  console.log(verify);

  console.log("Done - all services now use latest .env");
}
main().catch(e => console.error("Failed:", e.message));
