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
  ], { timeout: 20000, maxBuffer: 5 * 1024 * 1024 });
  return r.stdout?.toString() || "";
}

async function main() {
  await pushKey();
  // Get exact error around import-bulk 500
  console.log("=== IMPORT-BULK ERROR ===");
  const logs = ssh("grep -A10 'import-bulk.*500\\|import.*finaliz\\|finalization' /home/ubuntu/app/logs/api-error.log 2>/dev/null | tail -40");
  console.log(logs || "(no matches in error log)");

  await pushKey();
  // Look for any recent error around 01:34:20
  console.log("\n=== RECENT ERRORS ===");
  console.log(ssh("grep -B2 -A8 'Error:\\|Failed:\\|finaliz' /home/ubuntu/app/logs/api-error.log 2>/dev/null | tail -100"));

  await pushKey();
  // Check if the headers are trimmed in the CSV processing
  console.log("\n=== CSV IMPORT SUCCESS LOG ===");
  console.log(ssh("grep -B2 -A5 'import-csv.*200\\|CSV.*import\\|lead.*import' /home/ubuntu/app/logs/api-out.log 2>/dev/null | tail -30"));
}
main().catch(e => console.error("Failed:", e.message));
