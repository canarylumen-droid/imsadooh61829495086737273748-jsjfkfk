import { EC2InstanceConnectClient, SendSSHPublicKeyCommand } from "@aws-sdk/client-ec2-instance-connect";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const pubKey = readFileSync("C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\deploy-temp-key.pub", "utf8").trim();
const keyFile = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\deploy-temp-key";

async function sshCmd(cmd) {
  const client = new EC2InstanceConnectClient({ region: "us-east-1" });
  await client.send(new SendSSHPublicKeyCommand({
    InstanceId: "i-0fc13fe518b5f483e", InstanceOSUser: "ubuntu",
    SSHPublicKey: pubKey, AvailabilityZone: "us-east-1d"
  }));
  await new Promise(r => setTimeout(r, 2000));
  const ssh = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o IdentitiesOnly=yes -i ${keyFile} ubuntu@54.227.164.241`;
  return execSync(`${ssh} "${cmd}"`, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }).toString();
}

async function main() {
  console.log("=== ERROR LOG ===");
  console.log((await sshCmd("tail -50 /home/ubuntu/app/logs/lead-recovery-error.log 2>/dev/null || echo NO_LOG")));
}
main().catch(e => console.error("Failed:", e.message));
