use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailJob {
    pub id: String,
    pub recipient: String,
    pub from: String,
    pub subject: String,
    pub body: String,
    pub campaign_id: Option<String>,
    pub mailbox_id: Option<String>,
    pub lead_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub retry_count: u32,
    pub max_retries: u32,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_user: Option<String>,
    pub smtp_pass: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailResult {
    pub job_id: String,
    pub status: SendStatus,
    pub error: Option<String>,
    pub mx_used: Option<String>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SendStatus {
    Sent,
    Deferred,
    Bounced,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxVerifyJob {
    pub batch_id: String,
    pub row: u32,
    pub email: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub password: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxVerifyResult {
    pub batch_id: String,
    pub row: u32,
    pub email: String,
    pub ok: bool,
    pub error: Option<String>,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MxBatchJob {
    pub batch_id: String,
    pub domains: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MxBatchEntry {
    pub has_mx: bool,
    pub mx_servers: Vec<String>,
    pub lookup_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MxBatchResult {
    pub batch_id: String,
    pub results: std::collections::HashMap<String, MxBatchEntry>,
    pub error: Option<String>,
}
