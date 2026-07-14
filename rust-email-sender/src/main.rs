use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use redis::AsyncCommands;
use tokio::sync::Semaphore;

mod dns;
mod mailer;
mod queue;
mod config;

use config::Config;
use queue::EmailJob;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let config = Config::from_env()?;
    log::info!("Audnix Email Sender starting...");
    log::info!("Redis: {}", config.redis_url);
    log::info!("Workers: {}", config.worker_count);
    log::info!("Max connections per domain: {}", config.max_connections_per_domain);

    // Connect to Redis
    let redis_client = redis::Client::open(config.redis_url.as_str())?;
    let redis_conn = redis::tokio::ConnectionManager::new(redis_client.clone()).await?;

    // Initialize DNS resolver with caching
    let dns_resolver = Arc::new(dns::CachedResolver::new().await?);

    // Initialize mailer pool
    let mailer_pool = Arc::new(mailer::MailerPool::new(&config)?);

    // Semaphore to limit concurrent sends
    let semaphore = Arc::new(Semaphore::new(config.max_concurrent_sends));

    log::info!("Listening on queue: {}", config.queue_name);

    // Main loop: poll Redis for email jobs
    let mut interval = tokio::time::interval(Duration::from_millis(config.poll_interval_ms));

    loop {
        interval.tick().await;

        // Pop a job from the Redis list (non-blocking with BRPOP timeout)
        let job: Option<(String, String)> = {
            let mut conn = redis_conn.clone();
            conn.brpop(&config.queue_name, 0.1).await.ok()
        };

        if let Some((_queue_name, job_json)) = job {
            let job: EmailJob = match serde_json::from_str(&job_json) {
                Ok(j) => j,
                Err(e) => {
                    log::error!("Failed to deserialize job: {}", e);
                    continue;
                }
            };

            let permit = semaphore.clone().acquire_owned().await?;
            let dns = dns_resolver.clone();
            let pool = mailer_pool.clone();
            let redis = redis_conn.clone();
            let result_queue = config.result_queue_name.clone();

            tokio::spawn(async move {
                let result = send_email_job(&job, &dns, &pool).await;

                // Write result back to Redis
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
                let _: () = conn.lpush(&result_queue, result_json.to_string()).await
                    .unwrap_or_else(|e| {
                        log::error!("Failed to write result: {}", e);
                    });

                match result {
                    Ok(_) => log::info!("[{}] Sent to {}", job.id, job.recipient),
                    Err(e) => log::warn!("[{}] Failed: {} → {}", job.id, job.recipient, e),
                }

                drop(permit);
            });
        }
    }
}

async fn send_email_job(
    job: &EmailJob,
    dns: &dns::CachedResolver,
    pool: &mailer::MailerPool,
) -> Result<()> {
    // Resolve MX for recipient domain
    let domain = job.recipient.split('@').last()
        .ok_or_else(|| anyhow::anyhow!("Invalid recipient: {}", job.recipient))?;

    let mx_records = dns.resolve_mx(domain).await?;

    if mx_records.is_empty() {
        anyhow::bail!("No MX records for {}", domain);
    }

    // Try each MX in priority order
    let mut last_error = None;
    for mx in &mx_records {
        match pool.send_via_mx(&job.recipient, &job.from, &job.subject, &job.body, mx).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                log::debug!("MX {} failed: {}", mx, e);
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("All MX records failed for {}", domain)))
}
