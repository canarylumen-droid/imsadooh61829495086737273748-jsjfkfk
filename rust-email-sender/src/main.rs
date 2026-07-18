use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use redis::AsyncCommands;
use tokio::sync::Semaphore;
use serde_json;

mod mailer;
mod queue;
mod dns;
mod config;

use config::Config;
use queue::EmailJob;
use dns::{DnsResolver, DnsJob, DnsJobResult};

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let config = Config::from_env()?;
    log::info!("Audnix Email Sender starting...");
    log::info!("Redis: {}", config.redis_url);
    log::info!("Workers: {}", config.worker_count);

    // Connect to Redis
    let redis_client = redis::Client::open(config.redis_url.as_str())?;
    let redis_conn = redis::aio::ConnectionManager::new(redis_client.clone()).await?;

    // Initialize mailer pool
    let mailer_pool = Arc::new(mailer::MailerPool::new(&config)?);

    // Initialize DNS resolver
    let dns_resolver = DnsResolver::new().await?;

    // Semaphore to limit concurrent sends
    let send_semaphore = Arc::new(Semaphore::new(config.max_concurrent_sends));

    let email_queue = config.queue_name.clone();
    let dns_queue = config.dns_queue_name.clone();
    let email_result_queue = config.result_queue_name.clone();
    let dns_result_queue = config.dns_result_queue_name.clone();

    log::info!("Listening on email queue: {}", email_queue);
    log::info!("Listening on DNS queue: {}", dns_queue);

    // Main loop: poll Redis for both email and DNS jobs
    let mut interval = tokio::time::interval(Duration::from_millis(config.poll_interval_ms));

    loop {
        interval.tick().await;

        // Check both queues with a single BRPOP call
        let job_opt: Option<Vec<String>> = redis_conn.clone()
            .brpop(&[&email_queue, &dns_queue], 0.1).await.ok();

        if let Some(mut parts) = job_opt {
            if parts.len() < 2 { continue; }
            let queue_name = parts.remove(0);
            let job_json = parts.remove(0);

            if queue_name == email_queue {
                // ── Email Send Job ──────────────────────────────────────
                let job: EmailJob = match serde_json::from_str(&job_json) {
                    Ok(j) => j,
                    Err(e) => {
                        log::error!("Failed to deserialize email job: {}", e);
                        continue;
                    }
                };

                let permit = send_semaphore.clone().acquire_owned().await?;
                let pool = mailer_pool.clone();
                let redis = redis_conn.clone();
                let rq = email_result_queue.clone();

                tokio::spawn(async move {
                    let result = pool.send_via_job(&job).await;

                    let result_json = serde_json::json!({
                        "job_id": job.id,
                        "status": match &result {
                            Ok(_) => "sent",
                            Err(e) => "failed",
                        },
                        "error": match &result {
                            Ok(_) => None,
                            Err(e) => Some(e.to_string()),
                        },
                        "timestamp": chrono::Utc::now().to_rfc3339(),
                    });

                    let mut conn = redis.clone();
                    let _: () = conn.lpush(&rq, result_json.to_string()).await
                        .unwrap_or_else(|e| log::error!("Failed to write result: {}", e));

                    match result {
                        Ok(_) => log::info!("[{}] Sent to {}", job.id, job.recipient),
                        Err(e) => log::warn!("[{}] Failed: {} → {}", job.id, job.recipient, e),
                    }

                    drop(permit);
                });

            } else if queue_name == dns_queue {
                // ── DNS Verification Job ───────────────────────────────
                let job: DnsJob = match serde_json::from_str(&job_json) {
                    Ok(j) => j,
                    Err(e) => {
                        log::error!("Failed to deserialize DNS job: {}", e);
                        continue;
                    }
                };

                let resolver = dns_resolver.clone();
                let redis = redis_conn.clone();
                let rq = dns_result_queue.clone();

                tokio::spawn(async move {
                    let result = resolver.verify_domain(&job.domain, &job.dkim_selector).await;

                    let result_obj = DnsJobResult {
                        job_id: job.job_id.clone(),
                        user_id: job.user_id.clone(),
                        result,
                        error: None,
                        timestamp: chrono::Utc::now().to_rfc3339(),
                    };

                    let result_json = serde_json::to_string(&result_obj)
                        .unwrap_or_else(|e| format!("{{\"error\":\"{}\"}}", e));

                    let mut conn = redis.clone();
                    let _: () = conn.lpush(&rq, &result_json).await
                        .unwrap_or_else(|e| log::error!("Failed to write DNS result: {}", e));

                    log::info!("[{}] DNS verified {} (score: {})", job.job_id, job.domain, result_obj.result.overall_score);
                });
            }
        }
    }
}
