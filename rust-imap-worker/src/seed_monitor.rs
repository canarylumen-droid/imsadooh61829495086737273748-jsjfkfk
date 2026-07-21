use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use log::{info, warn, error, debug};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use tokio::sync::Mutex;
use tokio::time;
use dashmap::DashSet;

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
        // Reuse Redis connection
        let redis_client = redis::Client::open(self.redis_url.as_str())?;
        let redis_conn = ConnectionManager::new(redis_client).await?;
        let redis = Arc::new(Mutex::new(redis_conn));

        // Deduplicate seen message IDs in-process (faster than Redis round-trip)
        let seen_ids: Arc<DashSet<String>> = Arc::new(DashSet::new());

        loop {
            let result = self.run_once(&redis, &seen_ids).await;
            if let Err(e) = result {
                error!("Seed monitor error: {}. Reconnecting in 10s...", e);
            }
            time::sleep(Duration::from_secs(30)).await;
        }
    }

    async fn run_once(&self, redis: &Arc<Mutex<ConnectionManager>>, seen_ids: &DashSet<String>) -> Result<()> {
        let mut conn = ImapConnection::new("INBOX".to_string());
        conn.connect(&self.imap_host, self.imap_port, true).await?;
        conn.authenticate(&self.seed_email, &self.seed_password).await?;

        let folders = vec!["INBOX", "[Gmail]/Spam", "[Gmail]/Promotions"];

        for folder in &folders {
            if let Err(e) = conn.select(folder).await {
                debug!("Cannot select {}: {}", folder, e);
                continue;
            }

            // Use IDLE for real-time inbox monitoring on INBOX folder
            if *folder == "INBOX" {
                if let Err(e) = self.idle_and_fetch(&mut conn, redis, seen_ids).await {
                    error!("IDLE failed on {}: {}", folder, e);
                }
                continue;
            }

            // Poll-based for Spam/Promotions (IDLE not supported on non-INBOX in most providers)
            let raw = conn.fetch(0).await?;
            let messages = parse_fetch_response(&raw);

            for (uid, headers) in &messages {
                let id = headers.get("x-audnix-id")
                    .or_else(|| headers.get("message-id"))
                    .cloned();
                if let Some(ref id) = id {
                    if !seen_ids.insert(id.clone()) {
                        continue; // Already processed
                    }

                    let placement = if folder.contains("Spam") || folder.contains("Junk") {
                        "spam"
                    } else if folder.contains("Promotions") {
                        "promotions"
                    } else {
                        "inbox"
                    };

                    info!("Seed placement: {} → {} (message: {})", id, placement, folder);

                    // ════════════════════════════════════════════════════════════
                    // CRITICAL: Move warmup emails from Spam/Promotions to INBOX
                    // so the Node.js inbound worker can find them and reply.
                    // Without this, seeds detect placement but never reply.
                    // ════════════════════════════════════════════════════════════
                    if placement != "inbox" {
                        info!("Moving seed message {} from {} to INBOX", id, folder);
                        match conn.uid_move(*uid, "INBOX").await {
                            Ok(true) => {
                                info!("Moved {} → INBOX successfully", id);
                                // Mark as not-spam + important — trains ISP spam filter
                                let _ = conn.mark_not_spam_and_important(*uid).await;
                            }
                            Ok(false) => warn!("UID MOVE returned false for {} — trying COPY+DELETE fallback", id),
                            Err(_) => {
                                // Fallback: UID COPY + STORE +FLAGS.SILENT (\Deleted)
                                warn!("UID MOVE failed for {}, trying COPY+DELETE fallback", id);
                                let _ = conn.uid_copy_and_delete(*uid, "INBOX").await;
                            }
                        }
                    }

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

                    let mut guard = redis.lock().await;
                    let _ = guard.publish::<_, _, ()>("audnix-cluster:events", msg.to_string()).await;
                }
            }
        }

        let _ = conn.logout().await;
        Ok(())
    }

    async fn idle_and_fetch(&self, conn: &mut ImapConnection, redis: &Arc<Mutex<ConnectionManager>>, seen_ids: &DashSet<String>) -> Result<()> {
        // Enter IDLE — wait for server push notifications
        conn.idle().await?;
        info!("Seed monitor entered IDLE on INBOX");

        // Read server pushes in a loop with a keepalive NOOP every 15min
        let mut last_noop = std::time::Instant::now();
        loop {
            // Read line from server (IDLE pushes untagged "* ..." lines)
            let _ = conn.noop().await; // Triggers a read that gets IDLE notifications
            // Actually we need a different approach for IDLE - let's just read raw

            // For simplicity, check for EXISTS responses after exiting IDLE
            conn.idle_done().await?;

            // Fetch new messages
            let raw = conn.fetch(0).await?;
            let messages = parse_fetch_response(&raw);

            for (_uid, headers) in &messages {
                let id = headers.get("x-audnix-id")
                    .or_else(|| headers.get("message-id"))
                    .cloned();
                if let Some(ref id) = id {
                    if !seen_ids.insert(id.clone()) { continue; }

                    info!("Seed inbox: {} (message: {})", id, "INBOX");

                    let payload = serde_json::json!({
                        "type": "SEED_PLACEMENT",
                        "message_id": id,
                        "seed_email": self.seed_email,
                        "folder": "INBOX",
                        "placement": "inbox",
                        "timestamp": chrono::Utc::now().to_rfc3339()
                    });

                    let msg = serde_json::json!({
                        "event": "SEED_MONITOR",
                        "userId": null,
                        "payload": payload
                    });

                    let mut guard = redis.lock().await;
                    let _ = guard.publish::<_, _, ()>("audnix-cluster:events", msg.to_string()).await;
                }
            }

            // Re-enter IDLE
            conn.idle().await?;

            // Short sleep before next IDLE cycle
            time::sleep(Duration::from_secs(5)).await;

            if last_noop.elapsed() > Duration::from_secs(60) {
                conn.idle_done().await?;
                conn.noop().await?;
                conn.idle().await?;
                last_noop = std::time::Instant::now();
            }
        }
    }
}

fn parse_fetch_response(raw: &str) -> HashMap<u32, HashMap<String, String>> {
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
