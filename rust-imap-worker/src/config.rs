use std::env;
use anyhow::Result;

#[derive(Debug, Clone)]
pub struct Config {
    pub redis_url: String,
    pub database_url: String,
    pub queue_name: String,
    pub result_queue_name: String,
    pub worker_id: String,
    pub max_connections: usize,
    pub max_concurrent_operations: usize,
    pub heartbeat_secs: u64,
    pub idle_timeout_secs: u64,
    pub poll_interval_ms: u64,
    pub pg_max_connections: u32,
    pub fetch_batch_size: u32,
    pub zombie_timeout_secs: u64,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let worker_id = env::var("WORKER_ID")
            .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());

        Ok(Self {
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            database_url: env::var("DATABASE_URL")
                .expect("DATABASE_URL is required"),
            queue_name: env::var("IMAP_QUEUE_NAME")
                .unwrap_or_else(|_| "imap-idle-tasks".to_string()),
            result_queue_name: env::var("IMAP_RESULT_QUEUE_NAME")
                .unwrap_or_else(|_| "imap-idle-results".to_string()),
            worker_id,
            max_connections: env::var("MAX_CONNECTIONS")
                .unwrap_or_else(|_| "10000".to_string())
                .parse()?,
            max_concurrent_operations: env::var("MAX_CONCURRENT_OPS")
                .unwrap_or_else(|_| "500".to_string())
                .parse()?,
            heartbeat_secs: env::var("HEARTBEAT_SECS")
                .unwrap_or_else(|_| "10".to_string())
                .parse()?,
            idle_timeout_secs: env::var("IDLE_TIMEOUT_SECS")
                .unwrap_or_else(|_| "1680".to_string()) // 28 minutes (RFC 2177 safety)
                .parse()?,
            poll_interval_ms: env::var("POLL_INTERVAL_MS")
                .unwrap_or_else(|_| "50".to_string())
                .parse()?,
            pg_max_connections: env::var("PG_MAX_CONNECTIONS")
                .unwrap_or_else(|_| "20".to_string())
                .parse()?,
            fetch_batch_size: env::var("FETCH_BATCH_SIZE")
                .unwrap_or_else(|_| "50".to_string())
                .parse()?,
            zombie_timeout_secs: env::var("ZOMBIE_TIMEOUT_SECS")
                .unwrap_or_else(|_| "3600".to_string()) // 1 hour
                .parse()?,
        })
    }
}
