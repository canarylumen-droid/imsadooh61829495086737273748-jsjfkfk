use std::collections::HashMap;
use std::time::Duration;
use anyhow::Result;
use log::{info, warn, error, debug};
use redis::AsyncCommands;
use tokio::time;

use crate::imap_client::ImapConnection;

pub struct SeedMonitor {
    seed_email: String,
    seed_password: String,
    imap_host: String,
    imap_port: u16,
    redis_url: String,
}

impl SeedMonitor {
    pub fn new(
        seed_email: String,
        seed_password: String,
        imap_host: String,
        imap_port: u16,
        redis_url: String,
    ) -> Self {
        Self { seed_email, seed_password, imap_host, imap_port, redis_url }
    }

    pub async fn run(&self) -> Result<()> {
        let mut conn = ImapConnection::new("INBOX".to_string());
        conn.connect(&self.imap_host, self.imap_port, true).await?;
        conn.authenticate(&self.seed_email, &self.seed_password).await?;

        loop {
            if let Err(e) = self.check_seed_inboxes(&mut conn).await {
                error!("Seed inbox check failed: {}. Reconnecting...", e);
                let _ = conn.logout().await;
                tokio::time::sleep(Duration::from_secs(10)).await;
                conn = ImapConnection::new("INBOX".to_string());
                if conn.connect(&self.imap_host, self.imap_port, true).await.is_err() {
                    continue;
                }
                let _ = conn.authenticate(&self.seed_email, &self.seed_password).await;
            }
            time::sleep(Duration::from_secs(30)).await;
        }
    }

    async fn check_seed_inboxes(&self, conn: &mut ImapConnection) -> Result<()> {
        let folders = vec!["INBOX", "[Gmail]/Spam", "[Gmail]/Promotions"];

        for folder in &folders {
            if let Err(e) = conn.select(folder).await {
                debug!("Cannot select {}: {}", folder, e);
                continue;
            }

            let raw = conn.fetch(0).await?;
            let messages = self.parse_fetch_response(&raw);

            for (_uid, headers) in &messages {
                let x_audnix_id = headers.get("x-audnix-id")
                    .or_else(|| headers.get("message-id"))
                    .cloned();

                if let Some(ref id) = x_audnix_id {
                    let placement = if folder.contains("Spam") || folder.contains("Junk") {
                        "spam"
                    } else if folder.contains("Promotions") {
                        "promotions"
                    } else {
                        "inbox"
                    };

                    info!("Seed placement: {} → {} (message: {})", id, placement, folder);

                    let client = redis::Client::open(self.redis_url.clone())?;
                    let mut redis_conn = client.get_multiplexed_tokio_connection().await?;

                    let payload = serde_json::json!({
                        "type": "SEED_PLACEMENT",
                        "message_id": id,
                        "seed_email": self.seed_email,
                        "folder": folder,
                        "placement": placement,
                        "timestamp": chrono::Utc::now().to_rfc3339()
                    });

                    let msg = serde_json::json!({
                        "event": "SEED_MONITOR",
                        "userId": null,
                        "payload": payload
                    });

                    let _ = redis_conn.publish::<_, _, ()>("audnix-cluster:events", msg.to_string()).await;
                }
            }
        }

        Ok(())
    }

    fn parse_fetch_response(&self, raw: &str) -> HashMap<u32, HashMap<String, String>> {
        let mut messages: HashMap<u32, HashMap<String, String>> = HashMap::new();
        let mut current_uid: Option<u32> = None;
        let mut current_headers: HashMap<String, String> = HashMap::new();

        for line in raw.lines() {
            if let Some(uid_start) = line.find("UID ") {
                if let Some(uid_end) = line[uid_start + 4..].find(' ') {
                    if let Ok(uid) = line[uid_start + 4..uid_start + 4 + uid_end].trim().parse::<u32>() {
                        if let Some(old_uid) = current_uid {
                            messages.insert(old_uid, std::mem::take(&mut current_headers));
                        }
                        current_uid = Some(uid);
                    }
                }
            }

            if let Some(colon) = line.find(':') {
                if colon > 0 && colon < 50 {
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
}
