use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use redis::AsyncCommands;
use tokio::sync::Semaphore;

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
    let redis_conn = redis::aio::ConnectionManager::new(redis_client.clone()).await?;

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
        let job_opt: Option<(String, Vec<u8>)> = redis_conn.clone()
            .brpop(&config.queue_name, 0.1).await.ok();
        let job = job_opt.map(|(q, v)| (q, String::from_utf8_lossy(&v).to_string()));

        if let Some((_queue_name, job_json)) = job {
            let job: EmailJob = match serde_json::from_str(&job_json) {
                Ok(j) => j,
                Err(e) => {
                    log::error!("Failed to deserialize job: {}", e);
                    continue;
                }
            };

            let permit = semaphore.clone().acquire_owned().await?;
            let pool = mailer_pool.clone();
            let redis = redis_conn.clone();
            let result_queue = config.result_queue_name.clone();

            tokio::spawn(async move {
                let result = send_email_job(&job, &pool).await;

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
    pool: &mailer::MailerPool,
) -> Result<()> {
    pool.send_via_job(job).await
}
