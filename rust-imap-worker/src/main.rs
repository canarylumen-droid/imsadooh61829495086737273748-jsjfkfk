use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use redis::AsyncCommands;
use tokio::sync::Semaphore;

mod imap_client;

use imap_client::ImapConnection;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ImapJob {
    pub id: String,
    pub integration_id: String,
    pub email: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub username: String,
    pub password: String,
    pub folder: Option<String>,
    pub use_tls: Option<bool>,
}

async fn process_imap_job(job: &ImapJob) -> Result<String> {
    let folder = job.folder.as_deref().unwrap_or("INBOX");
    let mut conn = ImapConnection::new(folder.to_string());
    conn.connect(&job.imap_host, job.imap_port, job.use_tls.unwrap_or(true)).await?;
    conn.authenticate(&job.username, &job.password).await?;
    conn.select(folder).await?;
    let data = conn.fetch(0).await?;
    conn.logout().await?;
    Ok(data)
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    env_logger::init();

    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 4 {
        let host = &args[1];
        let port: u16 = args[2].parse()?;
        let username = &args[3];
        let password = &args[4];
        let folder = args.get(5).map(|s| s.as_str()).unwrap_or("INBOX");
        match test_imap_connect(host, port, username, password, folder).await {
            Ok(data) => {
                println!("✅ IMAP Test Successful!");
                println!("Server response:\n{}", &data[..data.len().min(500)]);
            }
            Err(e) => {
                eprintln!("❌ IMAP Test Failed: {}", e);
                std::process::exit(1);
            }
        }
        return Ok(());
    }

    let redis_url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let queue_name = std::env::var("IMAP_QUEUE_NAME")
        .unwrap_or_else(|_| "imap-queue".to_string());
    let result_queue = std::env::var("IMAP_RESULT_QUEUE_NAME")
        .unwrap_or_else(|_| "imap-results".to_string());
    let max_concurrent: usize = std::env::var("WORKER_COUNT")
        .unwrap_or_else(|_| "2".to_string()).parse().unwrap_or(2);

    log::info!("Audnix IMAP Worker starting...");
    log::info!("Redis: {}", redis_url);

    let redis_client = redis::Client::open(redis_url.as_str())?;
    let redis_conn = redis::aio::ConnectionManager::new(redis_client.clone()).await?;
    let semaphore = Arc::new(Semaphore::new(max_concurrent));

    log::info!("Listening on queue: {}", queue_name);

    loop {
        let job_opt: Option<(String, Vec<u8>)> = redis_conn.clone()
            .brpop(&queue_name, 0.1).await.ok();
        let job_json = job_opt.map(|(_, v)| String::from_utf8_lossy(&v).to_string());

        if let Some(json) = job_json {
            let job: ImapJob = match serde_json::from_str(&json) {
                Ok(j) => j,
                Err(e) => {
                    log::error!("Failed to deserialize IMAP job: {}", e);
                    continue;
                }
            };

            let permit = semaphore.clone().acquire_owned().await.unwrap();
            let redis = redis_conn.clone();
            let rq = result_queue.clone();

            tokio::spawn(async move {
                let result = process_imap_job(&job).await;
                let result_json = serde_json::json!({
                    "job_id": job.id,
                    "integration_id": job.integration_id,
                    "status": if result.is_ok() { "ok" } else { "error" },
                    "error": result.as_ref().err().map(|e| e.to_string()),
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                });
                let mut conn = redis.clone();
                let _: () = conn.lpush(&rq, result_json.to_string()).await
                    .unwrap_or_else(|e| log::error!("Failed to write result: {}", e));
                drop(permit);
            });
        }
    }
}

async fn test_imap_connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    folder: &str,
) -> Result<String> {
    let mut conn = ImapConnection::new(folder.to_string());
    conn.connect(host, port, true).await?;
    log::info!("Connected to {}:{}", host, port);
    conn.authenticate(username, password).await?;
    log::info!("Authenticated as {}", username);
    conn.select(folder).await?;
    log::info!("Selected folder: {}", folder);
    let result = conn.fetch(0).await?;
    log::info!("Fetch completed");
    conn.logout().await?;
    log::info!("Logged out");
    Ok(result)
}
