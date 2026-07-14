use std::time::Duration;
use anyhow::Result;
use lettre::message::{header::ContentType, Mailbox, Message};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use crate::dns::MxRecord;

pub struct MailerPool {
    transports: Vec<(String, AsyncSmtpTransport<Tokio1Executor>)>,
    port: u16,
    timeout: Duration,
}

impl MailerPool {
    pub fn new(config: &crate::config::Config) -> Result<Self> {
        // In production, these would come from environment variables
        // representing different sending domains/IPs
        let smtp_host = std::env::var("SMTP_HOST")
            .unwrap_or_else(|_| "127.0.0.1".to_string());
        let smtp_user = std::env::var("SMTP_USER")
            .unwrap_or_default();
        let smtp_pass = std::env::var("SMTP_PASS")
            .unwrap_or_default();

        let mut transports = Vec::new();

        // Create transport for the primary SMTP server
        if !smtp_user.is_empty() {
            let creds = Credentials::new(smtp_user.clone(), smtp_pass);
            let transport = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp_host)?
                .credentials(creds)
                .port(config.smtp_port)
                .timeout(Some(config::Duration::from_secs(config.smtp_timeout_secs)))
                .build();
            transports.push((smtp_host, transport));
        } else {
            // No auth — connect directly to KumoMTA or local MTA
            let transport = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(smtp_host.clone())
                .port(config.smtp_port)
                .timeout(Some(Duration::from_secs(config.smtp_timeout_secs)))
                .build();
            transports.push((smtp_host, transport));
        }

        Ok(Self {
            transports,
            port: config.smtp_port,
            timeout: Duration::from_secs(config.smtp_timeout_secs),
        })
    }

    pub async fn send_via_mx(
        &self,
        to: &str,
        from: &str,
        subject: &str,
        body: &str,
        mx: &MxRecord,
    ) -> Result<()> {
        let from_mailbox: Mailbox = from.parse()?;
        let to_mailbox: Mailbox = to.parse()?;

        let email = Message::builder()
            .from(from_mailbox)
            .to(to_mailbox)
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_string())?;

        // Build transport to this MX host
        let transport = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&mx.exchange)
            .port(self.port)
            .timeout(Some(self.timeout))
            .build();

        transport.send(email).await?;
        Ok(())
    }
}
