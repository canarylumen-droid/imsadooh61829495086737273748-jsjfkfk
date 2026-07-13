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
    "-o", "IdentitiesOnly=yes", "-i", keyFile, "ubuntu@54.227.164.241", cmd
  ], { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
  return r.stdout?.toString() || "";
}

async function main() {
  await pushKey();
  console.log("Pulling SQL fixes...");
  console.log(ssh("cd /home/ubuntu/app && git pull origin main 2>&1"));

  await pushKey();
  console.log("Restarting API gateway...");
  console.log(ssh("pm2 restart audnix-api-gateway --update-env && echo OK"));

  console.log("Done");
}
main().catch(e => console.error("Failed:", e.message));
