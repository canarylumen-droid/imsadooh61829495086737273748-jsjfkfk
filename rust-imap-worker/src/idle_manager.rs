use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use dashmap::DashMap;
use redis::AsyncCommands;
use sqlx::PgPool;
use log::{info, warn, error, debug};
use tokio::sync::RwLock;

use crate::config::Config;
use crate::imap_client::{ImapConnection, EmailHeader};
use crate::WorkerState;
use crate::ImapJob;

pub struct IdleManager {
    state: Arc<WorkerState>,
    redis: redis::aio::ConnectionManager,
    pg: PgPool,
    connections: DashMap<String, Arc<RwLock<ImapConnection>>>,
}

impl IdleManager {
    pub fn new(
        state: Arc<WorkerState>,
        redis: redis::aio::ConnectionManager,
        pg: PgPool,
    ) -> Self {
        Self {
            state,
            redis,
            pg,
            connections: DashMap::new(),
        }
    }

    pub async fn connect_mailbox(&self, job: ImapJob) -> Result<()> {
        let integration_id = job.integration_id.clone();

        // Check if already connected
        if self.connections.contains_key(&integration_id) {
            debug!("Already connected: {}", integration_id);
            return Ok(());
        }

        let mut conn = ImapConnection::new(
            job.folder.clone().unwrap_or_else(|| "INBOX".to_string())
        );

        // Connect with timeout
        let host = job.imap_host.clone();
        let port = job.imap_port;
        let use_tls = job.use_tls.unwrap_or(true);

        tokio::time::timeout(
            Duration::from_secs(15),
            conn.connect(&host, port, use_tls),
        ).await
            .map_err(|_| anyhow::anyhow!("Connection timeout for {}", host))?
            .map_err(|e| anyhow::anyhow!("Connection failed: {}", e))?;

        // Authenticate
        tokio::time::timeout(
            Duration::from_secs(10),
            conn.authenticate(&job.username, &job.password),
        ).await
            .map_err(|_| anyhow::anyhow!("Auth timeout"))?
            .map_err(|e| anyhow::anyhow!("Auth failed: {}", e))?;

        // Select folder
        let folder = job.folder.clone().unwrap_or_else(|| "INBOX".to_string());
        tokio::time::timeout(
            Duration::from_secs(5),
            conn.select(&folder),
        ).await
            .map_err(|_| anyhow::anyhow!("Select timeout"))?
            .map_err(|e| anyhow::anyhow!("Select failed: {}", e))?;

        let conn = Arc::new(RwLock::new(conn));
        self.connections.insert(integration_id.clone(), conn.clone());

        // Register in Redis for distributed tracking
        let mut redis_conn = self.redis.clone();
        let _: () = redis_conn.setex(
            format!("imap:conn:{}", integration_id),
            self.state.config.idle_timeout_secs as usize,
            serde_json::json!({
                "worker_id": self.state.config.worker_id,
                "folder": folder,
                "connected_at": chrono::Utc::now().to_rfc3339(),
            }).to_string(),
        ).await.unwrap_or_default();

        info!("Connected to mailbox: {} ({})", integration_id, folder);

        // Start IDLE loop in background
        let manager = self.clone();
        let id = integration_id.clone();
        let folder_clone = folder.clone();
        tokio::spawn(async move {
            if let Err(e) = manager.idle_loop(id, folder_clone).await {
                error!("IDLE loop ended: {}", e);
            }
        });

        Ok(())
    }

    async fn idle_loop(&self, integration_id: String, folder: String) -> Result<()> {
        let conn = self.connections.get(&integration_id)
            .ok_or_else(|| anyhow::anyhow!("Connection not found"))?
            .clone();

        loop {
            // Enter IDLE
            {
                let mut c = conn.write().await;
                tokio::time::timeout(
                    Duration::from_secs(5),
                    c.idle(),
                ).await
                    .map_err(|_| anyhow::anyhow!("IDLE command timeout"))?
                    .map_err(|e| anyhow::anyhow!("IDLE failed: {}", e))?;
            }

            // Wait for IDLE push or timeout
            let wait_duration = Duration::from_secs(self.state.config.idle_timeout_secs);
            match tokio::time::timeout(wait_duration, self.wait_for_idle_event(&integration_id)).await {
                Ok(Ok(()) => {
                    // Got new mail notification
                    self.handle_new_mail(&integration_id, &folder).await?;
                }
                Ok(Err(e)) => {
                    warn!("IDLE error for {}: {}", integration_id, e);
                    break;
                }
                Err(_) => {
                    // Timeout — recycle connection per RFC 2177
                    debug!("IDLE timeout for {}, recycling", integration_id);
                    break;
                }
            }

            // Exit IDLE
            {
                let mut c = conn.write().await;
                let _ = c.idle_done().await;
            }
        }

        Ok(())
    }

    async fn wait_for_idle_event(&self, integration_id: &str) -> Result<()> {
        // In a real implementation, this would wait on the TLS stream for
        // unsolicited server notifications (like "* EXISTS" or "* EXPUNGE")
        // For now, we use a heartbeat-based approach
        let mut interval = tokio::time::interval(Duration::from_secs(self.state.config.heartbeat_secs));
        loop {
            interval.tick().await;

            // Check if we should exit (e.g., disconnect signal in Redis)
            let mut redis_conn = self.redis.clone();
            let exists: bool = redis_conn.exists(format!("imap:disconnect:{}", integration_id)).await.unwrap_or(false);
            if exists {
                let _: () = redis_conn.del(format!("imap:disconnect:{}", integration_id)).await.unwrap_or_default();
                anyhow::bail!("Disconnect signal received");
            }
        }
    }

    async fn handle_new_mail(&self, integration_id: &str, folder: &str) -> Result<()> {
        let conn = self.connections.get(integration_id)
            .ok_or_else(|| anyhow::anyhow!("Connection not found"))?
            .clone();

        // Fetch new emails
        let emails = {
            let mut c = conn.write().await;
            c.fetch_new(0, 0).await.unwrap_or_default()
        };

        if emails.is_empty() {
            return Ok(());
        }

        info!("Found {} new emails in {} ({})", emails.len(), integration_id, folder);

        // Write results to Redis for Node.js to pick up
        let mut redis_conn = self.redis.clone();
        for email in &emails {
            let result = serde_json::json!({
                "integration_id": integration_id,
                "folder": folder,
                "uid": email.uid,
                "from": email.from,
                "subject": email.subject,
                "date": email.date,
                "timestamp": chrono::Utc::now().to_rfc3339(),
            });

            let _: () = redis_conn.lpush(
                &self.state.config.result_queue_name,
                result.to_string(),
            ).await.unwrap_or_default();
        }

        // Update last fetch timestamp
        let _: () = redis_conn.setex(
            format!("imap:last_fetch:{}", integration_id),
            300,
            chrono::Utc::now().to_rfc3339(),
        ).await.unwrap_or_default();

        Ok(())
    }

    pub async fn disconnect_mailbox(&self, integration_id: &str) {
        if let Some(conn) = self.connections.get(integration_id) {
            let mut c = conn.write().await;
            let _ = c.logout().await;
            drop(c);
        }
        self.connections.remove(integration_id);

        // Remove from Redis
        let mut redis_conn = self.redis.clone();
        let _: () = redis_conn.del(format!("imap:conn:{}", integration_id)).await.unwrap_or_default();

        info!("Disconnected mailbox: {}", integration_id);
    }

    pub async fn recycle_connection(&self, integration_id: &str) -> Result<()> {
        // Disconnect and reconnect
        self.disconnect_mailbox(integration_id).await;

        // Find the job in Redis to reconnect
        let mut redis_conn = self.redis.clone();
        let job_json: Option<String> = redis_conn.get(format!("imap:job:{}", integration_id)).await.unwrap_or(None);

        if let Some(json) = job_json {
            let job: ImapJob = serde_json::from_str(&json)?;
            self.connect_mailbox(job).await?;
        }

        Ok(())
    }

    pub async fn fetch_now(&self, job: ImapJob) -> Result<()> {
        let integration_id = job.integration_id.clone();

        if let Some(conn) = self.connections.get(&integration_id) {
            let mut c = conn.write().await;
            let emails = c.fetch_new(0, 0).await.unwrap_or_default();

            let mut redis_conn = self.redis.clone();
            for email in &emails {
                let result = serde_json::json!({
                    "integration_id": integration_id,
                    "uid": email.uid,
                    "from": email.from,
                    "subject": email.subject,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                });

                let _: () = redis_conn.lpush(
                    &self.state.config.result_queue_name,
                    result.to_string(),
                ).await.unwrap_or_default();
            }
        } else {
            // Not connected — connect first
            self.connect_mailbox(job).await?;
        }

        Ok(())
    }

    pub async fn check_zombies(&self) {
        let zombie_timeout = Duration::from_secs(self.state.config.zombie_timeout_secs);
        let mut to_recycle = Vec::new();

        for entry in self.connections.iter() {
            let conn = entry.value().clone();
            let is_zombie = {
                let c = conn.read().await;
                c.is_zombie(zombie_timeout)
            };

            if is_zombie {
                to_recycle.push(entry.key().clone());
            }
        }

        for id in to_recycle {
            warn!("Zombie detected: {}, recycling", id);
            if let Err(e) = self.recycle_connection(&id).await {
                error!("Failed to recycle zombie {}: {}", id, e);
            }
        }
    }
}

impl Clone for IdleManager {
    fn clone(&self) -> Self {
        Self {
            state: self.state.clone(),
            redis: self.redis.clone(),
            pg: self.pg.clone(),
            connections: self.connections.clone(),
        }
    }
}
