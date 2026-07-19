use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use anyhow::Result;
use dashmap::DashMap;
use lettre::message::{header::ContentType, Mailbox, Message};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use tokio::sync::Mutex;
use crate::queue::EmailJob;

struct PooledTransport {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    last_used: Instant,
}

pub struct MailerPool {
    timeout: Duration,
    transports: DashMap<String, Arc<Mutex<PooledTransport>>>,
    max_per_host: usize,
}

impl MailerPool {
    pub fn new(config: &crate::config::Config) -> Result<Self> {
        Ok(Self {
            timeout: Duration::from_secs(config.smtp_timeout_secs),
            transports: DashMap::new(),
            max_per_host: config.max_connections_per_domain,
        })
    }

    fn pool_key(host: &str, user: &str, port: u16) -> String {
        format!("{}:{}:{}", host, user, port)
    }

    async fn get_or_create_transport(&self, host: &str, user: &str, pass: &str, port: u16) -> Result<Arc<Mutex<PooledTransport>>> {
        let key = Self::pool_key(host, user, port);

        // Fast path: existing connection
        if let Some(entry) = self.transports.get(&key) {
            let mut transport = entry.lock().await;
            transport.last_used = Instant::now();
            return Ok(entry.clone());
        }

        // Slow path: create new connection
        let creds = Credentials::new(user.to_string(), pass.to_string());
        let transport = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)?
            .credentials(creds)
            .port(port)
            .timeout(Some(self.timeout))
            .build();

        let pooled = Arc::new(Mutex::new(PooledTransport {
            transport,
            last_used: Instant::now(),
        }));

        // Evict oldest if over capacity for this host prefix
        if self.transports.len() >= self.max_per_host * 10 {
            let oldest_key = self.transports.iter()
                .min_by_key(|e| e.value().try_lock().ok().map(|t| t.last_used))
                .map(|e| e.key().clone());
            if let Some(k) = oldest_key {
                self.transports.remove(&k);
            }
        }

        self.transports.insert(key.clone(), pooled.clone());
        Ok(pooled)
    }

    pub async fn send_via_job(&self, job: &EmailJob) -> Result<()> {
        let from_mailbox: Mailbox = job.from.parse()?;
        let to_mailbox: Mailbox = job.recipient.parse()?;

        let email = Message::builder()
            .from(from_mailbox)
            .to(to_mailbox)
            .subject(&job.subject)
            .header(ContentType::TEXT_HTML)
            .body(job.body.clone())?;

        if let (Some(ref host), Some(ref user), Some(ref pass)) = (&job.smtp_host, &job.smtp_user, &job.smtp_pass) {
            let port = job.smtp_port.unwrap_or(587);
            let transport_lock = self.get_or_create_transport(host, user, pass, port).await?;
            let mut guard = transport_lock.lock().await;
            guard.transport.send(email).await?;
            guard.last_used = Instant::now();
        } else {
            anyhow::bail!("EmailJob has no SMTP credentials and no fallback SMTP_HOST configured");
        }
        Ok(())
    }
}
