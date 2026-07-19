use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use log::{info, warn, error, debug};
use redis::AsyncCommands;
use tokio::sync::Mutex;
use tokio::time;

use crate::imap_client::ImapConnection;

/// Configuration for a user mailbox to monitor via persistent IMAP IDLE.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct MailboxConfig {
    pub integration_id: String,
    pub user_id: String,
    pub email: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub username: String,
    pub password: String,
    pub use_tls: Option<bool>,
}

/// Tracks per-mailbox monitor state.
struct MailboxState {
    config: MailboxConfig,
    last_uid: u32,
    uidvalidity: u32,
}

/// Redis list keys for mailbox monitor commands from Node.js.
const REDIS_ADD_QUEUE: &str = "mailbox-monitor:add";
const REDIS_REMOVE_QUEUE: &str = "mailbox-monitor:remove";
const REDIS_CHANNEL: &str = "audnix-cluster:events";

pub struct MailboxMonitor {
    redis_url: String,
    mailboxes: Arc<Mutex<HashMap<String, MailboxState>>>,
}

impl MailboxMonitor {
    pub fn new(redis_url: String) -> Self {
        Self {
            redis_url,
            mailboxes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn run(&self) -> Result<()> {
        let redis_client = redis::Client::open(self.redis_url.as_str())?;
        let mut redis_conn = redis::aio::ConnectionManager::new(redis_client.clone()).await?;
        let mailboxes = self.mailboxes.clone();
        let redis_url = self.redis_url.clone();

        info!("MailboxMonitor: Starting IDLE monitors for user mailboxes");

        // Drain any existing mailbox configs first (bulk load)
        loop {
            let entry: Option<String> = redis_conn
                .lpop(REDIS_ADD_QUEUE, None)
                .await
                .unwrap_or(None);
            match entry {
                Some(json) => {
                    if let Ok(config) = serde_json::from_str::<MailboxConfig>(&json) {
                        let mut map = mailboxes.lock().await;
                        if !map.contains_key(&config.integration_id) {
                            info!("MailboxMonitor: Adding mailbox {} ({})", config.integration_id, config.email);
                            let state = MailboxState {
                                config: config.clone(),
                                last_uid: 0,
                                uidvalidity: 0,
                            };
                            map.insert(config.integration_id.clone(), state);
                            let mid = config.integration_id.clone();
                            let redis = redis_url.clone();
                            let mailboxes_clone = mailboxes.clone();
                            tokio::spawn(async move {
                                monitor_mailbox_loop(mid, redis, mailboxes_clone).await;
                            });
                        }
                    }
                }
                None => break,
            }
        }

        // Also drain any pending removals
        loop {
            let entry: Option<String> = redis_conn
                .lpop(REDIS_REMOVE_QUEUE, None)
                .await
                .unwrap_or(None);
            match entry {
                Some(id) => {
                    let mut map = mailboxes.lock().await;
                    if map.remove(&id).is_some() {
                        info!("MailboxMonitor: Removed mailbox {}", id);
                    }
                }
                None => break,
            }
        }

        info!("MailboxMonitor: Loaded {} mailbox(es), entering event-driven mode", mailboxes.lock().await.len());

        // Event-driven loop: BLPOP with 0.0 = infinite block, zero polling
        loop {
            let result: Option<(String, String)> = redis_conn
                .blpop(vec![REDIS_ADD_QUEUE, REDIS_REMOVE_QUEUE], 0.0)
                .await
                .unwrap_or(None);

            if let Some((list, value)) = result {
                if list == REDIS_ADD_QUEUE {
                    match serde_json::from_str::<MailboxConfig>(&value) {
                        Ok(config) => {
                            let mut map = mailboxes.lock().await;
                            if !map.contains_key(&config.integration_id) {
                                info!("MailboxMonitor: Adding mailbox {} ({})", config.integration_id, config.email);
                                let state = MailboxState {
                                    config: config.clone(),
                                    last_uid: 0,
                                    uidvalidity: 0,
                                };
                                map.insert(config.integration_id.clone(), state);
                                let mid = config.integration_id.clone();
                                let redis = redis_url.clone();
                                let mailboxes_clone = mailboxes.clone();
                                tokio::spawn(async move {
                                    monitor_mailbox_loop(mid, redis, mailboxes_clone).await;
                                });
                            } else {
                                if let Some(s) = map.get_mut(&config.integration_id) {
                                    s.config = config;
                                }
                            }
                        }
                        Err(e) => warn!("MailboxMonitor: Invalid mailbox config JSON: {}", e),
                    }
                } else if list == REDIS_REMOVE_QUEUE {
                    let mut map = mailboxes.lock().await;
                    if map.remove(&value).is_some() {
                        info!("MailboxMonitor: Removed mailbox {}", value);
                    }
                }
            }
        }
    }
}

/// Per-mailbox persistent IDLE loop. Runs as a tokio task.
async fn monitor_mailbox_loop(
    integration_id: String,
    redis_url: String,
    mailboxes: Arc<Mutex<HashMap<String, MailboxState>>>,
) {
    let mut consecutive_failures = 0;

    // Register as active in Redis so Node.js knows to skip this mailbox.
    // Uses SET with 5-min TTL so stale entries auto-expire if Rust crashes.
    let active_key = format!("mailbox-monitor:active:{}", integration_id);
    let active_client = redis::Client::open(redis_url.as_str());
    if let Ok(client) = active_client {
        if let Ok(mut conn) = client.get_multiplexed_tokio_connection().await {
            let _: Result<(), _> = conn.set_ex::<_, _, ()>(&active_key, "1", 300).await;
        }
    }

    // Refresh active TTL periodically
    async fn refresh_active(redis_url: &str, key: &str) {
        if let Ok(client) = redis::Client::open(redis_url) {
            if let Ok(mut conn) = client.get_multiplexed_tokio_connection().await {
                let _: Result<(), _> = conn.expire::<_, ()>(key, 300).await;
            }
        }
    }

    // Cleanup on exit: remove from active set
    let cleanup_key = active_key.clone();
    let cleanup_redis_url = redis_url.clone();
    let cleanup = async move {
        if let Ok(client) = redis::Client::open(cleanup_redis_url.as_str()) {
            if let Ok(mut conn) = client.get_multiplexed_tokio_connection().await {
                let _: Result<(), _> = conn.del::<_, ()>(&cleanup_key).await;
            }
        }
    };

    let mut last_refresh = std::time::Instant::now();

    loop {
        // Check if this mailbox should still be monitored
        {
            let map = mailboxes.lock().await;
            if !map.contains_key(&integration_id) {
                info!("MailboxMonitor: {} removed during reconnect, stopping", integration_id);
                cleanup.await;
                return;
            }
        }

        // Refresh active TTL every 60 seconds
        if last_refresh.elapsed() > Duration::from_secs(60) {
            refresh_active(&redis_url, &active_key).await;
            last_refresh = std::time::Instant::now();
        }

        match run_idle_session(&integration_id, &redis_url, &mailboxes).await {
            Ok(()) => {
                consecutive_failures = 0;
                // Normal disconnect (e.g., 29-min recycle) — reconnect immediately
                debug!("MailboxMonitor: {} idle session ended, reconnecting", integration_id);
            }
            Err(e) => {
                consecutive_failures += 1;
                let backoff = (Duration::from_secs(5) * consecutive_failures.min(30)).min(Duration::from_secs(300));
                warn!("MailboxMonitor: {} error: {}. Reconnecting in {}s (attempt {})",
                    integration_id, e, backoff.as_secs(), consecutive_failures);
                time::sleep(backoff).await;
            }
        }
    }
}

/// Single IDLE session: connect → authenticate → SELECT → IDLE → detect → fetch → publish.
async fn run_idle_session(
    integration_id: &str,
    redis_url: &str,
    mailboxes: &Arc<Mutex<HashMap<String, MailboxState>>>,
) -> Result<()> {
    let config = {
        let map = mailboxes.lock().await;
        map.get(integration_id).map(|s| s.config.clone())
    };
    let config = match config {
        Some(c) => c,
        None => return Ok(()),
    };

    let mut conn = ImapConnection::new("INBOX".to_string());
    let use_tls = config.use_tls.unwrap_or(true);
    conn.connect(&config.imap_host, config.imap_port, use_tls).await
        .map_err(|e| anyhow::anyhow!("Connect failed: {}", e))?;
    conn.authenticate(&config.username, &config.password).await
        .map_err(|e| anyhow::anyhow!("Auth failed: {}", e))?;

    let select_response = conn.select("INBOX").await
        .map_err(|e| anyhow::anyhow!("SELECT failed: {}", e))?;

    let uidvalidity = conn.get_uidvalidity(&select_response);
    let uidnext = conn.get_uidnext(&select_response);

    // Track UID state
    {
        let mut map = mailboxes.lock().await;
        if let Some(state) = map.get_mut(integration_id) {
            if state.uidvalidity == 0 || state.uidvalidity != uidvalidity {
                debug!("MailboxMonitor: {} UIDVALIDITY changed {} → {}, resetting UID tracking", integration_id, state.uidvalidity, uidvalidity);
                state.uidvalidity = uidvalidity;
                state.last_uid = if uidnext > 1 { uidnext - 1 } else { 0 };
            }
        }
    }

    info!("MailboxMonitor: ✅ IDLE started for {} ({}) UIDNEXT={}", integration_id, config.email, uidnext);

    let idle_timeout_secs: u64 = 29 * 60; // 29 min proactive recycle
    let redis_client = redis::Client::open(redis_url)?;

    loop {
        // Check if we should still be running
        {
            let map = mailboxes.lock().await;
            if !map.contains_key(integration_id) {
                let _ = conn.logout().await;
                return Ok(());
            }
            // Refresh config (password may have changed)
        }

        // Enter IDLE
        if let Err(e) = conn.idle().await {
            warn!("MailboxMonitor: {} IDLE enter failed: {}", integration_id, e);
            let _ = conn.logout().await;
            return Err(e);
        }

        // Wait for push notification or timeout
        let push_data = match conn.wait_for_idle_push(idle_timeout_secs).await {
            Ok(data) => data,
            Err(e) => {
                warn!("MailboxMonitor: {} IDLE wait error: {}", integration_id, e);
                let _ = conn.idle_done().await;
                let _ = conn.logout().await;
                return Err(e);
            }
        };

        // Exit IDLE before fetching
        let _ = conn.idle_done().await;

        // If empty string, it was a timeout (proactive recycle)
        if push_data.is_empty() {
            info!("MailboxMonitor: {} proactive recycle (29-min timeout)", integration_id);
            let _ = conn.logout().await;
            return Ok(());
        }

        // Parse EXISTS count from push data
        let exists_count = parse_exists_count(&push_data);
        debug!("MailboxMonitor: {} EXISTS detected: {} messages", integration_id, exists_count);

        if exists_count == 0 {
            continue;
        }

        // Fetch new message headers
        let last_uid = {
            let map = mailboxes.lock().await;
            map.get(integration_id).map(|s| s.last_uid).unwrap_or(0)
        };

        let raw = match conn.fetch(last_uid).await {
            Ok(r) => r,
            Err(e) => {
                warn!("MailboxMonitor: {} fetch error: {}", integration_id, e);
                continue;
            }
        };

        // Parse headers and determine new UIDs
        let messages = parse_fetch_response(&raw);
        let mut max_uid = last_uid;

        for (uid, headers) in &messages {
            if *uid <= last_uid { continue; }
            if *uid > max_uid { max_uid = *uid; }

            // Skip warmup seed / test emails (self-sent check)
            let sender_addr = headers.get("from").cloned().unwrap_or_default().to_lowercase();
            if sender_addr.contains(&config.email.to_lowercase()) {
                debug!("MailboxMonitor: Skipping self-sent email {}", uid);
                continue;
            }

            // Fetch full email content
            let full_raw = match conn.fetch_full(*uid).await {
                Ok(r) => r,
                Err(e) => {
                    warn!("MailboxMonitor: {} fetch_full uid={} error: {}", integration_id, uid, e);
                    continue;
                }
            };

            // Extract body content from full fetch
            let body = extract_body_text(&full_raw);

            // Publish to Redis for Node.js processing
            let payload = serde_json::json!({
                "type": "INBOUND_EMAIL",
                "integration_id": integration_id,
                "user_id": config.user_id,
                "uid": uid,
                "message_id": headers.get("message-id").cloned().unwrap_or_default(),
                "from": headers.get("from").cloned().unwrap_or_default(),
                "to": headers.get("to").cloned().unwrap_or_default(),
                "subject": headers.get("subject").cloned().unwrap_or_default(),
                "date": headers.get("date").cloned().unwrap_or_default(),
                "in_reply_to": headers.get("in-reply-to").cloned().unwrap_or_default(),
                "references": headers.get("references").cloned().unwrap_or_default(),
                "snippet": body.chars().take(500).collect::<String>(),
                "raw_email": full_raw.chars().take(100000).collect::<String>(),
                "timestamp": chrono::Utc::now().to_rfc3339()
            });

            let msg = serde_json::json!({
                "event": "INBOUND_EMAIL",
                "payload": payload
            });

            match redis_client.get_multiplexed_tokio_connection().await {
                Ok(mut rconn) => {
                    let _ = rconn.publish::<_, _, ()>(REDIS_CHANNEL, msg.to_string()).await;
                }
                Err(e) => {
                    warn!("MailboxMonitor: Redis publish error: {}", e);
                }
            }

            info!("MailboxMonitor: 📬 Published inbound email uid={} from {} for user {}",
                uid, headers.get("from").unwrap_or(&"?".to_string()), config.user_id);
        }

        // Update last_uid
        {
            let mut map = mailboxes.lock().await;
            if let Some(state) = map.get_mut(integration_id) {
                if max_uid > state.last_uid {
                    state.last_uid = max_uid;
                }
            }
        }

        // Brief pause before resuming IDLE to avoid busy loops
        time::sleep(Duration::from_millis(500)).await;
    }
}

/// Parse EXISTS count from IDLE push data.
/// Looks for "* N EXISTS" pattern and returns the highest N.
fn parse_exists_count(data: &str) -> u32 {
    let mut max_count = 0u32;
    for line in data.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("* ") {
            if let Some(pos) = rest.rfind(" EXISTS") {
                if let Ok(n) = rest[..pos].trim().parse::<u32>() {
                    if n > max_count { max_count = n; }
                }
            }
        }
    }
    max_count
}

/// Parse FETCH response into UID → header map.
/// Enhanced to handle folded headers and multi-line responses.
fn parse_fetch_response(raw: &str) -> HashMap<u32, HashMap<String, String>> {
    let mut messages: HashMap<u32, HashMap<String, String>> = HashMap::new();
    let mut current_uid: Option<u32> = None;
    let mut current_headers: HashMap<String, String> = HashMap::new();
    let mut in_header_block = false;

    for line in raw.lines() {
        // Detect UID in response lines like "* 1 FETCH (UID 123 ...)"
        if let Some(uid_start) = line.find("UID ") {
            let after_uid = &line[uid_start + 4..];
            // UID is followed by space or paren
            if let Some(uid_end) = after_uid.find(|c: char| c == ' ' || c == ')' || c == ']') {
                if let Ok(uid) = after_uid[..uid_end].trim().parse::<u32>() {
                    if let Some(old_uid) = current_uid {
                        messages.insert(old_uid, std::mem::take(&mut current_headers));
                    }
                    current_uid = Some(uid);
                    in_header_block = true;
                    continue;
                }
            }
        }

        // Parse header lines
        if in_header_block {
            let trimmed = line.trim();

            // End of header block
            if trimmed.starts_with(')') || trimmed.is_empty() || trimmed.starts_with('*') && trimmed.contains("FETCH") {
                continue;
            }

            // Folded header (starts with space/tab) — append to previous value
            if (trimmed.starts_with(' ') || trimmed.starts_with('\t')) && !trimmed.is_empty() {
                if let Some(last_key) = current_headers.keys().last().cloned() {
                    if let Some(val) = current_headers.get_mut(&last_key) {
                        val.push(' ');
                        val.push_str(trimmed.trim());
                    }
                }
                continue;
            }

            // Normal header line
            if let Some(colon) = trimmed.find(':') {
                if colon > 0 && colon < 50 {
                    let key = trimmed[..colon].trim().to_lowercase();
                    let value = trimmed[colon + 1..].trim().to_string();
                    current_headers.insert(key, value);
                }
            }
        }
    }

    if let Some(uid) = current_uid {
        messages.insert(uid, current_headers);
    }

    messages
}

/// Extract plain text body from raw IMAP FETCH BODY[] response.
/// Handles simple MIME messages and quoted-printable content.
fn extract_body_text(raw: &str) -> String {
    // Find the body content between (BODY[] and the closing )
    let mut body_start = None;
    let mut depth = 0;
    let mut in_body = false;

    // Look for BODY[] {size} pattern or BODY[] followed by content
    for line in raw.lines() {
        if line.contains("BODY[") && line.contains('{') {
            in_body = true;
            // The actual body starts on the next line after the literal size
            continue;
        }
        if in_body {
            // Skip IMAP response metadata lines
            if line.trim().starts_with('*') || line.trim().starts_with('A') {
                continue;
            }
            // Stop at the closing tag
            if line.trim().is_empty() {
                continue;
            }
            // Return the first non-metadata line as body
            // For proper extraction, we'd need a MIME parser
            if line.len() > 10 && !line.contains("FLAGS") && !line.contains("UID ") {
                // Strip MIME encoding artifacts
                let cleaned = line
                    .replace("=\r\n", "")
                    .replace("=\n", "")
                    .replace("=3D", "=")
                    .replace("=20", " ")
                    .replace("=0A", "\n")
                    .replace("=0D", "\r");
                return cleaned;
            }
        }
    }

    // Fallback: try to find text content between Content-Type: text/plain and next boundary
    if let Some(plain_start) = raw.find("Content-Type: text/plain") {
        if let Some(body_end) = raw[plain_start..].find("--") {
            let body_section = &raw[plain_start + "Content-Type: text/plain".len()..plain_start + body_end];
            // Skip header lines (charset, encoding, etc.)
            for line in body_section.lines() {
                if line.trim().is_empty() || line.contains(':') {
                    continue;
                }
                return line.trim().to_string();
            }
        }
    }

    String::new()
}
