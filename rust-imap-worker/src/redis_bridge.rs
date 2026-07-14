use anyhow::Result;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};

pub struct RedisBridge {
    conn: redis::aio::ConnectionManager,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionState {
    pub worker_id: String,
    pub integration_id: String,
    pub folder: String,
    pub connected_at: String,
    pub last_heartbeat: String,
    pub emails_found: u32,
}

impl RedisBridge {
    pub fn new(conn: redis::aio::ConnectionManager) -> Self {
        Self { conn }
    }

    pub async fn register_connection(&self, state: ConnectionState) -> Result<()> {
        let mut conn = self.conn.clone();
        let key = format!("imap:conn:{}", state.integration_id);

        let _: () = conn.setex(
            &key,
            1800, // 30 minute TTL
            serde_json::to_string(&state)?,
        ).await?;

        // Add to active connections set
        let _: () = conn.sadd(
            "imap:active_connections",
            &state.integration_id,
        ).await?;

        Ok(())
    }

    pub async fn unregister_connection(&self, integration_id: &str) -> Result<()> {
        let mut conn = self.conn.clone();

        let _: () = conn.del(format!("imap:conn:{}", integration_id)).await?;
        let _: () = conn.srem("imap:active_connections", integration_id).await?;

        Ok(())
    }

    pub async fn update_heartbeat(&self, integration_id: &str, worker_id: &str) -> Result<()> {
        let mut conn = self.conn.clone();

        let _: () = conn.setex(
            format!("imap:heartbeat:{}", integration_id),
            60,
            chrono::Utc::now().to_rfc3339(),
        ).await?;

        Ok(())
    }

    pub async fn get_active_connections(&self) -> Result<Vec<String>> {
        let mut conn = self.conn.clone();
        let members: Vec<String> = conn.smembers("imap:active_connections").await?;
        Ok(members)
    }

    pub async fn is_connected(&self, integration_id: &str) -> Result<bool> {
        let mut conn = self.conn.clone();
        let exists: bool = conn.exists(format!("imap:conn:{}", integration_id)).await?;
        Ok(exists)
    }

    pub async fn push_result(&self, queue: &str, result: serde_json::Value) -> Result<()> {
        let mut conn = self.conn.clone();
        let _: () = conn.lpush(queue, result.to_string()).await?;
        Ok(())
    }

    pub async fn pop_job(&self, queue: &str, timeout_ms: u64) -> Result<Option<String>> {
        let mut conn = self.conn.clone();
        let result: Option<(String, String)> = conn.brpop(queue, timeout_ms as f64 / 1000.0).await?;
        Ok(result.map(|(_, v)| v))
    }
}
