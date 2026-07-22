import { SendSSHPublicKeyCommand, EC2InstanceConnectClient } from "@aws-sdk/client-ec2-instance-connect";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const INSTANCE_ID = "i-0fc13fe518b5f483e";
const REGION = "us-east-1";
const USERNAME = "ubuntu";

async function main() {
  const pubKey = readFileSync(".temp-ssh-key.pub", "utf-8").trim();
  const client = new EC2InstanceConnectClient({ region: REGION });

  console.log("Pushing SSH key...");
  await client.send(new SendSSHPublicKeyCommand({
    InstanceId: INSTANCE_ID, InstanceOSUser: USERNAME, SSHPublicKey: pubKey, AvailabilityZone: "us-east-1d",
  }));
  console.log("Key pushed. Connecting...");

  const cmd = `cd /home/ubuntu/app && node -e "
    (async () => {
      const mysql = require('mysql2/promise');
      const pool = mysql.createPool({
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'lead_recovery',
        waitForConnections: true, connectionLimit: 5, queueLimit: 0,
      });

      const p = pool;
      await p.query(\`CREATE TABLE IF NOT EXISTS lead_recovery_state (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        mailbox_id VARCHAR(255) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 0,
        last_sync_at DATETIME NULL,
        sync_requested_at DATETIME NULL,
        sync_status ENUM('idle', 'queued', 'syncing', 'completed', 'failed') NOT NULL DEFAULT 'idle',
        is_busy TINYINT(1) NOT NULL DEFAULT 0,
        available_at DATETIME NULL,
        error_message TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_tenant_mailbox (tenant_id, mailbox_id),
        INDEX idx_tenant_id (tenant_id),
        INDEX idx_is_active (is_active),
        INDEX idx_sync_status (sync_status)
      )\`);
      console.log('lead_recovery_state ✓');

      try { await p.query('ALTER TABLE lead_recovery_state ADD COLUMN error_message TEXT NULL AFTER sync_status'); } catch {}

      await p.query(\`CREATE TABLE IF NOT EXISTS recovered_leads (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        mailbox_id VARCHAR(255) NOT NULL,
        source_mailbox_provider VARCHAR(50) NULL,
        source_mailbox_account_type VARCHAR(50) NULL,
        email VARCHAR(255) NOT NULL,
        subject TEXT NULL,
        intent ENUM('Converted', 'Ghosted', 'Not-Interested', 'Reply-Needed') NOT NULL,
        deliverability_status ENUM('safe', 'risky', 'invalid', 'unknown') NOT NULL DEFAULT 'unknown',
        follow_up_draft TEXT NULL,
        conversation_summary TEXT NULL,
        last_message_text TEXT NULL,
        last_message_at DATETIME NULL,
        brainstormed_objections JSON NULL,
        source_message_ids JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_tenant_mailbox_email (tenant_id, mailbox_id, email),
        INDEX idx_tenant_id (tenant_id),
        INDEX idx_intent (intent),
        INDEX idx_tenant_created (tenant_id, created_at)
      )\`);
      console.log('recovered_leads ✓');

      await p.query(\`CREATE TABLE IF NOT EXISTS recovery_prompt_config (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        system_prompt TEXT NOT NULL,
        user_prompt_template TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )\`);
      console.log('recovery_prompt_config ✓');

      await p.query(\`CREATE TABLE IF NOT EXISTS recovery_event_logs (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        action VARCHAR(100) NOT NULL,
        payload JSON NULL,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tenant_id (tenant_id),
        INDEX idx_action (action),
        INDEX idx_timestamp (timestamp),
        INDEX idx_tenant_timestamp (tenant_id, timestamp)
      )\`);
      console.log('recovery_event_logs ✓');

      await p.query(\`CREATE TABLE IF NOT EXISTS recovery_objections (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        category VARCHAR(80) NOT NULL,
        rule VARCHAR(500) NOT NULL,
        evidence VARCHAR(500) NULL,
        source_lead_id VARCHAR(36) NULL,
        created_by ENUM('ai', 'user') NOT NULL DEFAULT 'ai',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_tenant_rule (tenant_id, rule),
        INDEX idx_tenant_id (tenant_id)
      )\`);
      console.log('recovery_objections ✓');

      await pool.end();
      console.log('\\nAll tables created successfully.');
    })().catch(e => { console.error(e.message); process.exit(1); });
  "`;

  const output = execSync(`ssh -o StrictHostKeyChecking=no -i .temp-ssh-key ubuntu@54.227.164.241 "${cmd.replace(/"/g, '\\"')}"`, { timeout: 30000, shell: "powershell" });
  console.log(output.toString());
}

main().catch(err => { console.error("Failed:", err.message); process.exit(1); });
