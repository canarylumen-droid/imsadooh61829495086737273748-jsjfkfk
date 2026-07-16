use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use tokio::sync::Semaphore;
use dashmap::DashMap;
use tokio::sync::RwLock;

mod imap_client;

use imap_client::ImapConnection;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ImapJob {
    pub id: String,
    pub command: String,
    pub integration_id: String,
    pub email: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub username: String,
    pub password: String,
    pub folder: Option<String>,
    pub use_tls: Option<bool>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ImapResult {
    pub job_id: String,
    pub integration_id: String,
    pub status: String,
    pub emails_found: Option<u32>,
    pub error: Option<String>,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

pub struct WorkerState {
    pub active_connections: DashMap<String, Arc<RwLock<ImapConnection>>>,
    pub semaphore: Semaphore,
}

impl WorkerState {
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            active_connections: DashMap::new(),
            semaphore: Semaphore::new(max_concurrent),
        }
    }
}

/// Quick standalone test: connect to an IMAP server and authenticate
pub async fn test_imap_connect(
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

    // Fetch recent messages
    let result = conn.fetch(0).await?;
    log::info!("Fetch completed");

    conn.logout().await?;
    log::info!("Logged out");

    Ok(result)
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    env_logger::init();
    log::info!("Audnix IMAP Worker starting...");

    // If command-line args provided, run as standalone test
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

    log::info!("No IMAP credentials provided. Run with: cargo run --release -- <host> <port> <username> <password> [folder]");
    Ok(())
}
