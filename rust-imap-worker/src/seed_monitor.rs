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

        // Track last processed UID per folder to avoid re-fetching everything
        let inbox_last_uid: Arc<std::sync::Mutex<u32>> = Arc::new(std::sync::Mutex::new(0));
        let spam_last_uid: Arc<std::sync::Mutex<u32>> = Arc::new(std::sync::Mutex::new(0));

        // Reconnect and scan all folders from scratch on startup
        self.scan_spam_promotions(&redis, &seen_ids, &spam_last_uid).await?;

        // Enter continuous IDLE loop for INBOX — periodically breaks to re-scan Spam/Promotions
        self.idle_loop(&redis, &seen_ids, &inbox_last_uid, &spam_last_uid).await
    }

    /// Scan Spam and Promotions folders for warmup emails, move to INBOX.
    async fn scan_spam_promotions(
        &self,
        redis: &Arc<Mutex<ConnectionManager>>,
        seen_ids: &DashSet<String>,
        spam_last_uid: &std::sync::Mutex<u32>,
    ) -> Result<()> {
        let mut conn = ImapConnection::new("INBOX".to_string());
        conn.connect(&self.imap_host, self.imap_port, true).await?;
        conn.authenticate(&self.seed_email, &self.seed_password).await?;

        let spam_folders = vec!["[Gmail]/Spam", "[Gmail]/Promotions", "[Gmail]/Junk"];

        for folder in &spam_folders {
            if let Err(e) = conn.select(folder).await {
                debug!("Cannot select {}: {}", folder, e);
                continue;
            }

            let last_uid = *spam_last_uid.lock().unwrap();
            let raw = conn.fetch(last_uid).await?;
            let messages = parse_fetch_response(&raw);

            // Update last_uid from response if we saw a higher UID
            if let Some(max_uid) = messages.keys().max() {
                let mut stored = spam_last_uid.lock().unwrap();
                if *max_uid > *stored {
                    *stored = *max_uid;
                }
            }

            self.process_messages(messages, folder, &mut conn, redis, seen_ids).await;
        }

        let _ = conn.logout().await;
        Ok(())
    }

    /// Process parsed IMAP messages: check headers, move from spam, publish events.
    async fn process_messages(
        &self,
        messages: HashMap<u32, HashMap<String, String>>,
        folder: &str,
        conn: &mut ImapConnection,
        redis: &Arc<Mutex<ConnectionManager>>,
        seen_ids: &DashSet<String>,
    ) {
        for (uid, headers) in &messages {
            let id = headers.get("x-audnix-id")
                .or_else(|| headers.get("message-id"))
                .cloned();
            if let Some(ref id) = id {
                if !seen_ids.insert(id.clone()) {
                    continue;
                }

                let placement = if folder.contains("Spam") || folder.contains("Junk") {
                    "spam"
                } else if folder.contains("Promotions") {
                    "promotions"
                } else {
                    "inbox"
                };

                info!("Seed placement: {} → {} (message: {})", id, placement, folder);

                // Move warmup emails from Spam/Promotions to INBOX
                if placement != "inbox" {
                    info!("Moving seed message {} from {} to INBOX", id, folder);
                    match conn.uid_move(*uid, "INBOX").await {
                        Ok(true) => {
                            info!("Moved {} → INBOX successfully", id);
                            let _ = conn.mark_not_spam_and_important(*uid).await;
                        }
                        Ok(false) => warn!("UID MOVE returned false for {} — trying COPY+DELETE fallback", id),
                        Err(_) => {
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

    /// Continuous IDLE loop for INBOX. Processes push notifications as they arrive.
    /// Breaks out every SPAM_SCAN_INTERVAL to re-scan Spam/Promotions folders.
    async fn idle_loop(
        &self,
        redis: &Arc<Mutex<ConnectionManager>>,
        seen_ids: &DashSet<String>,
        inbox_last_uid: &std::sync::Mutex<u32>,
        spam_last_uid: &std::sync::Mutex<u32>,
    ) -> Result<()> {
        const SPAM_SCAN_INTERVAL_SECS: u64 = 300; // 5 minutes

        loop {
            let mut conn = ImapConnection::new("INBOX".to_string());
            conn.connect(&self.imap_host, self.imap_port, true).await?;
            conn.authenticate(&self.seed_email, &self.seed_password).await?;

            // Scan Spam/Promotions first
            let _ = self.scan_spam_promotions(redis, seen_ids, spam_last_uid).await;

            // Enter IDLE for INBOX — continuous monitoring for up to 5 minutes
            let scan_start = std::time::Instant::now();
            let _ = self.idle_and_fetch(redis, seen_ids, inbox_last_uid, SPAM_SCAN_INTERVAL_SECS).await;
            let elapsed = scan_start.elapsed();

            // Logout cleanly
            let _ = conn.logout().await;

            // If IDLE loop exited early (error or timeout), wait a moment before reconnecting
            if elapsed.as_secs() < SPAM_SCAN_INTERVAL_SECS {
                time::sleep(Duration::from_secs(5)).await;
            }

            // Loop back: scan Spam/Promotions again, then re-enter IDLE
        }
    }

    async fn idle_and_fetch(
        &self,
        redis: &Arc<Mutex<ConnectionManager>>,
        seen_ids: &DashSet<String>,
        inbox_last_uid: &std::sync::Mutex<u32>,
        max_duration_secs: u64,
    ) -> Result<()> {
        let mut conn = ImapConnection::new("INBOX".to_string());
        conn.connect(&self.imap_host, self.imap_port, true).await?;
        conn.authenticate(&self.seed_email, &self.seed_password).await?;
        let select_resp = conn.select("INBOX").await?;
        info!("Seed monitor selected INBOX");

        // Update last_uid from UIDNEXT in SELECT response — skip old messages
        let uidnext = conn.get_uidnext(&select_resp);
        if uidnext > 0 {
            let mut stored = inbox_last_uid.lock().unwrap();
            if uidnext > *stored {
                *stored = uidnext - 1;
            }
        }

        let start = std::time::Instant::now();

        loop {
            // Check if we've exceeded the max duration — time to scan Spam/Promotions
            if start.elapsed().as_secs() >= max_duration_secs {
                info!("Seed idle period complete, reconnecting to scan Spam/Promotions");
                let _ = conn.logout().await;
                return Ok(());
            }

            // Enter IDLE — wait for server push notifications
            if let Err(e) = conn.idle().await {
                warn!("IDLE enter failed: {}, reconnecting", e);
                let _ = conn.logout().await;
                return Ok(());
            }

            // Wait for push notification or timeout (60s max)
            let push = conn.wait_for_idle_push(60).await.unwrap_or_default();

            // Exit IDLE
            let _ = conn.idle_done().await;

            if push.contains("EXISTS") || push.contains("RECENT") {
                // New mail! Fetch only unprocessed messages
                let last_uid = *inbox_last_uid.lock().unwrap();
                let raw = conn.fetch(last_uid).await?;
                let messages = parse_fetch_response(&raw);

                // Update last_uid
                if let Some(max_uid) = messages.keys().max() {
                    let mut stored = inbox_last_uid.lock().unwrap();
                    if *max_uid > *stored {
                        *stored = *max_uid;
                    }
                }

                for (_uid, headers) in &messages {
                    let id = headers.get("x-audnix-id")
                        .or_else(|| headers.get("message-id"))
                        .cloned();
                    if let Some(ref id) = id {
                        if !seen_ids.insert(id.clone()) { continue; }

                        info!("Seed inbox: {} (new message)", id);

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
            } else if !push.is_empty() {
                debug!("IDLE push received but no new mail: {}", push);
            }

            // NOOP keepalive every cycle (IDLE was just re-entered and exited)
            let _ = conn.noop().await;
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
