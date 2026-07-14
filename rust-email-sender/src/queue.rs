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
