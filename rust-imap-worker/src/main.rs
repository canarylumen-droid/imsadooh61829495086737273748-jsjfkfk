use anyhow::Result;

mod imap_client;
mod dmarc_ruf;
mod seed_monitor;
mod mailbox_monitor;

use imap_client::ImapConnection;

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

    // Start DMARC RUF listener
    if let Ok(forensics_email) = std::env::var("FORENSICS_EMAIL") {
        let forensics_password = std::env::var("FORENSICS_PASSWORD")
            .expect("FORENSICS_PASSWORD required when FORENSICS_EMAIL is set");
        let forensics_host = std::env::var("FORENSICS_IMAP_HOST")
            .unwrap_or_else(|_| "imap.gmail.com".to_string());
        let forensics_port: u16 = std::env::var("FORENSICS_IMAP_PORT")
            .unwrap_or_else(|_| "993".to_string()).parse().unwrap_or(993);

        log::info!("Starting DMARC RUF listener for {}", forensics_email);
        let listener = dmarc_ruf::DmarcRufListener::new(
            forensics_email, forensics_password, forensics_host, forensics_port, redis_url.clone(),
        );
        tokio::spawn(async move {
            if let Err(e) = listener.run().await {
                log::error!("DMARC RUF listener failed: {}", e);
            }
        });
    }

    // Start seed monitor
    if let Ok(seed_email) = std::env::var("SEED_MONITOR_EMAIL") {
        let seed_password = std::env::var("SEED_MONITOR_PASSWORD")
            .expect("SEED_MONITOR_PASSWORD required when SEED_MONITOR_EMAIL is set");
        let seed_host = std::env::var("SEED_MONITOR_IMAP_HOST")
            .unwrap_or_else(|_| "imap.gmail.com".to_string());
        let seed_port: u16 = std::env::var("SEED_MONITOR_IMAP_PORT")
            .unwrap_or_else(|_| "993".to_string()).parse().unwrap_or(993);

        log::info!("Starting Seed Monitor for {}", seed_email);
        let monitor = seed_monitor::SeedMonitor::new(
            seed_email, seed_password, seed_host, seed_port, redis_url.clone(),
        );
        tokio::spawn(async move {
            if let Err(e) = monitor.run().await {
                log::error!("Seed monitor failed: {}", e);
            }
        });
    }

    // Start Mailbox Monitor (user mailbox IDLE connections) — handles 500+ mailboxes
    log::info!("Audnix IMAP Worker starting... Mailbox Monitor active (event-driven, zero polling)");
    let monitor = mailbox_monitor::MailboxMonitor::new(redis_url.clone());
    monitor.run().await
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
