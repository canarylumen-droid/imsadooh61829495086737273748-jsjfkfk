use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use log::{info, error, debug};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use tokio::sync::Mutex;
use tokio::time;
use dashmap::DashSet;

use crate::imap_client::ImapConnection;

pub struct DmarcRufListener {
    forensics_email: String,
    forensics_password: String,
    forensics_imap_host: String,
    forensics_imap_port: u16,
    redis_url: String,
}

impl DmarcRufListener {
    pub fn new(
        forensics_email: String,
        forensics_password: String,
        forensics_imap_host: String,
        forensics_imap_port: u16,
        redis_url: String,
    ) -> Self {
        Self { forensics_email, forensics_password, forensics_imap_host, forensics_imap_port, redis_url }
    }

    pub async fn run(&self) -> Result<()> {
        // Reuse Redis connection
        let redis_client = redis::Client::open(self.redis_url.as_str())?;
        let redis_conn = ConnectionManager::new(redis_client).await?;
        let redis = Arc::new(Mutex::new(redis_conn));

        // Deduplicate seen UIDs in-process
        let seen_uids: Arc<DashSet<u32>> = Arc::new(DashSet::new());

        loop {
            let result = self.run_once(&redis, &seen_uids).await;
            if let Err(e) = result {
                error!("DMARC RUF error: {}. Reconnecting in 10s...", e);
            }
            time::sleep(Duration::from_secs(10)).await;
        }
    }

    async fn run_once(&self, redis: &Arc<Mutex<ConnectionManager>>, seen_uids: &DashSet<u32>) -> Result<()> {
        let mut conn = ImapConnection::new("INBOX".to_string());
        conn.connect(&self.forensics_imap_host, self.forensics_imap_port, true).await?;
        conn.authenticate(&self.forensics_email, &self.forensics_password).await?;
        conn.select("INBOX").await?;

        loop {
            // Use IDLE for real-time monitoring
            conn.idle().await?;
            debug!("DMARC listener entered IDLE on INBOX");

            // Wait 30s for IDLE pushes, then check for new messages
            tokio::select! {
                _ = time::sleep(Duration::from_secs(30)) => {}
            }

            conn.idle_done().await?;
            conn.noop().await?;

            match self.check_new_reports(&mut conn, redis, seen_uids).await {
                Ok(_) => {}
                Err(e) => {
                    error!("DMARC check error: {}", e);
                    let _ = conn.logout().await;
                    return Err(e);
                }
            }
        }
    }

    async fn check_new_reports(&self, conn: &mut ImapConnection, redis: &Arc<Mutex<ConnectionManager>>, seen_uids: &DashSet<u32>) -> Result<()> {
        let raw = conn.fetch(0).await?;
        let messages = parse_fetch_response(&raw);

        for (uid, headers) in &messages {
            if !seen_uids.insert(*uid) {
                continue; // Already processed
            }

            let subject = headers.get("subject").cloned().unwrap_or_default();
            let from = headers.get("from").cloned().unwrap_or_default();

            let is_forensic = subject.to_lowercase().contains("dmarc")
                || subject.to_lowercase().contains("forensic")
                || subject.to_lowercase().contains("abuse")
                || subject.to_lowercase().contains("auth-failure")
                || from.to_lowercase().contains("postmaster")
                || from.to_lowercase().contains("mailer-daemon");

            if !is_forensic { continue; }

            info!("DMARC forensic report from: {}, subject: {}", from, subject);

            let payload = serde_json::json!({
                "type": "DMARC_REPORT",
                "from": from,
                "subject": subject,
                "uid": uid,
                "headers": headers,
                "timestamp": chrono::Utc::now().to_rfc3339()
            });

            let msg = serde_json::json!({
                "event": "DMARC_REPORT",
                "userId": null,
                "payload": payload
            });

            let mut guard = redis.lock().await;
            let _ = guard.publish::<_, _, ()>("audnix-cluster:events", msg.to_string()).await;
        }

        Ok(())
    }
}

fn parse_fetch_response(raw: &str) -> HashMap<u32, HashMap<String, String>> {
    let mut messages: HashMap<u32, HashMap<String, String>> = HashMap::new();
    let mut current_uid: Option<u32> = None;
    let mut current_headers: HashMap<String, String> = HashMap::new();

    for line in raw.lines() {
        if let Some(uid_start) = line.find("UID ") {
            let after_uid = &line[uid_start + 4..];
            if let Some(uid_end) = after_uid.find(' ') {
                if let Ok(uid) = after_uid[..uid_end].trim().parse::<u32>() {
                    if let Some(old_uid) = current_uid {
                        messages.insert(old_uid, std::mem::take(&mut current_headers));
                    }
                    current_uid = Some(uid);
                }
            }
        }

        if let Some(colon) = line.find(':') {
            if colon > 0 && colon < 50 && !line.starts_with('*') && !line.starts_with('A') {
                let key = line[..colon].trim().to_lowercase();
                let value = line[colon + 1..].trim().to_string();
                current_headers.insert(key, value);
            }
        }
    }

    if let Some(uid) = current_uid {
        messages.insert(uid, current_headers);
    }

    messages
}
