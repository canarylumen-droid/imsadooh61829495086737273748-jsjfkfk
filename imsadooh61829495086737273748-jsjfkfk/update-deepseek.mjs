import { EC2InstanceConnectClient, SendSSHPublicKeyCommand } from "@aws-sdk/client-ec2-instance-connect";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";

const pubKey = readFileSync("C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\deploy-temp-key.pub", "utf8").trim();
const keyFile = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\deploy-temp-key";

const envContent = readFileSync("C:\\Users\\USER\\audnix-ai-project\\.env", "utf8");
const key = envContent.match(/^DEEPSEEK_API_KEY=(.+)$/m)?.[1]?.trim();

async function pushKey() {
  const client = new EC2InstanceConnectClient({ region: "us-east-1" });
  await client.send(new SendSSHPublicKeyCommand({
    InstanceId: "i-0fc13fe518b5f483e", InstanceOSUser: "ubuntu",
    SSHPublicKey: pubKey, AvailabilityZone: "us-east-1d"
  }));
  await new Promise(r => setTimeout(r, 2000));
}

function sshExec(remoteCmd, timeout = 15000) {
  const args = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=10",
    "-o", "IdentitiesOnly=yes",
    "-i", keyFile,
    "ubuntu@54.227.164.241",
    remoteCmd,
  ];
  const r = spawnSync("ssh", args, { timeout, maxBuffer: 1024 * 1024 });
  return { out: r.stdout?.toString() || "", err: r.stderr?.toString() || "", code: r.status };
}

async function main() {
  console.log("DeepSeek key:", key?.substring(0, 15) + "...");

  await pushKey();
  const { out: before } = sshExec("grep DEEPSEEK_API_KEY /home/ubuntu/app/.env || echo NOT_FOUND");
  console.log("Before:", before.trim());

  await pushKey();
  // sed replace the line
  const { out: sedOut } = sshExec(`sed -i 's|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=${key}|' /home/ubuntu/app/.env && echo OK`);
  console.log("Sed:", sedOut.trim());

  await pushKey();
  const { out: after } = sshExec("grep DEEPSEEK_API_KEY /home/ubuntu/app/.env");
  console.log("After:", after.trim());

  if (after.includes(key)) {
    await pushKey();
    console.log("Restarting workers...");
    const { out: restart } = sshExec("pm2 restart audnix-worker-ai audnix-worker-orchestrator audnix-worker-rag audnix-worker-knowledge && echo RESTARTED", 30000);
    console.log(restart.trim());
  }
}
main().catch(e => console.error("Failed:", e.message));
