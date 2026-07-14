use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use redis::AsyncCommands;
use tokio::sync::{Semaphore, RwLock};
use dashmap::DashMap;

mod config;
mod imap_client;
mod idle_manager;
mod mail_parser;
mod redis_bridge;

use config::Config;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let config = Config::from_env()?;
    log::info!("Audnix IMAP Worker starting...");
    log::info!("Max connections: {}", config.max_connections);
    log::info!("Heartbeat interval: {}s", config.heartbeat_secs);
    log::info!("Idle timeout: {}s", config.idle_timeout_secs);

    // Connect to Redis
    let redis_client = redis::Client::open(config.redis_url.as_str())?;
    let redis_conn = redis::tokio::ConnectionManager::new(redis_client.clone()).await?;

    // Connect to PostgreSQL
    let pg_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(config.pg_max_connections)
        .connect(&config.database_url)
        .await?;

    // Shared state
    let state = Arc::new(WorkerState::new(config.clone()));

    // Start the idle manager
    let idle_manager = Arc::new(idle_manager::IdleManager::new(
        state.clone(),
        redis_conn.clone(),
        pg_pool.clone(),
    ));

    // Start heartbeat task
    let heartbeat_state = state.clone();
    let heartbeat_redis = redis_conn.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            heartbeat_state.update_heartbeat(&heartbeat_redis).await;
        }
    });

    // Start connection monitor
    let monitor_manager = idle_manager.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        loop {
            interval.tick().await;
            monitor_manager.check_zombies().await;
        }
    });

    // Main loop: poll Redis for IMAP jobs
    let mut interval = tokio::time::interval(Duration::from_millis(config.poll_interval_ms));

    log::info!("Listening for IMAP jobs...");

    loop {
        interval.tick().await;

        // Pop a job from the Redis list
        let job: Option<(String, String)> = {
            let mut conn = redis_conn.clone();
            conn.brpop(&config.queue_name, 0.1).await.ok()
        };

        if let Some((_queue_name, job_json)) = job {
            let job: ImapJob = match serde_json::from_str(&job_json) {
                Ok(j) => j,
                Err(e) => {
                    log::error!("Failed to deserialize IMAP job: {}", e);
                    continue;
                }
            };

            match job.command.as_str() {
                "connect" => {
                    let manager = idle_manager.clone();
                    tokio::spawn(async move {
                        if let Err(e) = manager.connect_mailbox(job).await {
                            log::error!("Connect failed: {}", e);
                        }
                    });
                }
                "disconnect" => {
                    let manager = idle_manager.clone();
                    tokio::spawn(async move {
                        manager.disconnect_mailbox(&job.integration_id).await;
                    });
                }
                "fetch" => {
                    let manager = idle_manager.clone();
                    tokio::spawn(async move {
                        if let Err(e) = manager.fetch_now(job).await {
                            log::error!("Fetch failed: {}", e);
                        }
                    });
                }
                "recycle" => {
                    let manager = idle_manager.clone();
                    tokio::spawn(async move {
                        manager.recycle_connection(&job.integration_id).await;
                    });
                }
                unknown => {
                    log::warn!("Unknown IMAP command: {}", unknown);
                }
            }
        }
    }
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ImapJob {
    pub id: String,
    pub command: String,
    pub integration_id: String,
    pub email: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub username: String,
    pub password: String,
    pub folder: Option<String>,
    pub use_tls: Option<bool>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ImapResult {
    pub job_id: String,
    pub integration_id: String,
    pub status: String,
    pub emails_found: Option<u32>,
    pub error: Option<String>,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

pub struct WorkerState {
    pub config: Config,
    pub active_connections: DashMap<String, Arc<RwLock<imap_client::ImapConnection>>>,
    pub semaphore: Semaphore,
}

impl WorkerState {
    pub fn new(config: Config) -> Self {
        let max_concurrent = config.max_concurrent_operations;
        Self {
            config,
            active_connections: DashMap::new(),
            semaphore: Semaphore::new(max_concurrent),
        }
    }

    pub async fn update_heartbeat(&self, redis: &redis::aio::ConnectionManager) {
        let mut conn = redis.clone();
        let _: () = conn.setex(
            format!("imap-worker:{}:heartbeat", self.config.worker_id),
            30,
            chrono::Utc::now().to_rfc3339(),
        ).await.unwrap_or_default();

        let active = self.active_connections.len();
        let _: () = conn.setex(
            format!("imap-worker:{}:connections", self.config.worker_id),
            30,
            active.to_string(),
        ).await.unwrap_or_default();
    }
}
