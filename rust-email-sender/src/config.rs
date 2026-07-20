use std::env;
use anyhow::Result;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct Config {
    pub redis_url: String,
    pub queue_name: String,
    pub result_queue_name: String,
    pub worker_count: usize,
    pub max_concurrent_sends: usize,
    pub max_connections_per_domain: usize,
    pub poll_interval_ms: u64,
    pub smtp_timeout_secs: u64,
    pub smtp_port: u16,
    pub dns_queue_name: String,
    pub dns_result_queue_name: String,
    pub mailbox_verify_queue: String,
    pub mailbox_verify_result_queue: String,
    pub scheduling_queue: String,
    pub scheduling_result_queue: String,
    pub max_concurrent_verifies: usize,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            queue_name: env::var("EMAIL_QUEUE_NAME")
                .unwrap_or_else(|_| "email-send-queue".to_string()),
            result_queue_name: env::var("EMAIL_RESULT_QUEUE_NAME")
                .unwrap_or_else(|_| "email-send-results".to_string()),
            dns_queue_name: env::var("DNS_QUEUE_NAME")
                .unwrap_or_else(|_| "dns-verify-queue".to_string()),
            dns_result_queue_name: env::var("DNS_RESULT_QUEUE_NAME")
                .unwrap_or_else(|_| "dns-verify-results".to_string()),
            mailbox_verify_queue: env::var("MAILBOX_VERIFY_QUEUE")
                .unwrap_or_else(|_| "bulk-mailbox-verify".to_string()),
            mailbox_verify_result_queue: env::var("MAILBOX_VERIFY_RESULT_QUEUE")
                .unwrap_or_else(|_| "bulk-mailbox-verify-results".to_string()),
            scheduling_queue: env::var("SCHEDULING_QUEUE")
                .unwrap_or_else(|_| "scheduling-queue".to_string()),
            scheduling_result_queue: env::var("SCHEDULING_RESULT_QUEUE")
                .unwrap_or_else(|_| "scheduling-results".to_string()),
            worker_count: env::var("WORKER_COUNT")
                .unwrap_or_else(|_| "4".to_string())
                .parse()?,
            max_concurrent_sends: env::var("MAX_CONCURRENT_SENDS")
                .unwrap_or_else(|_| "100".to_string())
                .parse()?,
            max_connections_per_domain: env::var("MAX_CONNECTIONS_PER_DOMAIN")
                .unwrap_or_else(|_| "5".to_string())
                .parse()?,
            max_concurrent_verifies: env::var("MAX_CONCURRENT_VERIFIES")
                .unwrap_or_else(|_| "200".to_string())
                .parse()?,
            poll_interval_ms: env::var("POLL_INTERVAL_MS")
                .unwrap_or_else(|_| "50".to_string())
                .parse()?,
            smtp_timeout_secs: env::var("SMTP_TIMEOUT_SECS")
                .unwrap_or_else(|_| "15".to_string())
                .parse()?,
            smtp_port: env::var("SMTP_PORT")
                .unwrap_or_else(|_| "587".to_string())
                .parse()?,
        })
    }
}
