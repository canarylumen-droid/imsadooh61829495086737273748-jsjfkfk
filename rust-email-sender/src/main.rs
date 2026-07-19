use std::sync::Arc;
use anyhow::Result;
use redis::AsyncCommands;
use tokio::sync::Semaphore;
use serde_json;

mod mailer;
mod queue;
mod dns;
mod config;
mod telemetry;

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

    // Initialize telemetry probe with MX-level caching
    let telemetry = telemetry::SmtpTelemetry::new();

    // Semaphore to limit concurrent sends
    let send_semaphore = Arc::new(Semaphore::new(config.max_concurrent_sends));

    // Batch accumulator for Redis LPUSH — coalesce results to reduce round-trips
    let batch_buf: Arc<tokio::sync::Mutex<Vec<String>>> = Arc::new(tokio::sync::Mutex::new(Vec::with_capacity(100)));

    // Flush batch every 100ms or 100 items
    {
        let bb = batch_buf.clone();
        let rq = config.result_queue_name.clone();
        let mut redis = redis_conn.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                let mut buf = bb.lock().await;
                if !buf.is_empty() {
                    let batch: Vec<String> = buf.drain(..).collect();
                    // Pipeline all LPUSH commands
                    for item in batch {
                        let _: Result<(), _> = redis.lpush(&rq, &item).await;
                    }
                }
            }
        });
    }

    let email_queue = config.queue_name.clone();
    let dns_queue = config.dns_queue_name.clone();
    let dns_result_queue = config.dns_result_queue_name.clone();

    log::info!("Listening on email queue: {}", email_queue);
    log::info!("Listening on DNS queue: {}", dns_queue);

    // Main loop: event-driven — blocks on BRPOP with infinite timeout (zero polling)
    loop {
        let job_opt: Option<Vec<String>> = redis_conn.clone()
            .brpop(&[&email_queue, &dns_queue], 0.0).await.ok();

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
                let resolver = dns_resolver.clone();
                let tele = telemetry.clone();
                let batch = batch_buf.clone();

                tokio::spawn(async move {
                    let domain = job.recipient.split('@').nth(1).unwrap_or("unknown").to_string();

                    // Run SMTP telemetry probe before sending (cached per MX host)
                    if let Ok(mx_records) = resolver.resolve_mx(&domain).await {
                        if let Some(mx) = mx_records.first() {
                            let mx_host = mx.exchange.trim_end_matches('.').to_string();
                            match tele.probe(&job.recipient, &domain, &mx_host).await {
                                Ok(report) => {
                                    if matches!(report.suspected_placement, telemetry::PlacementGuess::TarpittedSpamQueue | telemetry::PlacementGuess::Rejected | telemetry::PlacementGuess::GreylistedOrThrottled) {
                                        log::warn!("[{}] Telemetry risk: {:?} for {} via {} ({}ms)", job.id, report.suspected_placement, job.recipient, mx_host, report.rcpt_latency_ms);
                                    } else {
                                        log::debug!("[{}] Telemetry OK: {:?} for {} ({}ms)", job.id, report.suspected_placement, job.recipient, report.rcpt_latency_ms);
                                    }
                                }
                                Err(e) => {
                                    log::debug!("[{}] Telemetry skipped (non-fatal): {}", job.id, e);
                                }
                            }
                        }
                    }

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

                    // Batch the result instead of per-message LPUSH
                    let mut buf = batch.lock().await;
                    buf.push(result_json.to_string());

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
