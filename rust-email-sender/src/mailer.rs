use std::time::Duration;
use anyhow::Result;
use lettre::message::{header::ContentType, Mailbox, Message};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use crate::queue::EmailJob;

pub struct MailerPool {
    timeout: Duration,
}

impl MailerPool {
    pub fn new(config: &crate::config::Config) -> Result<Self> {
        Ok(Self {
            timeout: Duration::from_secs(config.smtp_timeout_secs),
        })
    }

    pub async fn send_via_job(&self, job: &EmailJob) -> Result<()> {
        let from_mailbox: Mailbox = job.from.parse()?;
        let to_mailbox: Mailbox = job.recipient.parse()?;

        let email = Message::builder()
            .from(from_mailbox)
            .to(to_mailbox)
            .subject(&job.subject)
            .header(ContentType::TEXT_PLAIN)
            .body(job.body.clone())?;

        if let (Some(ref host), Some(ref user), Some(ref pass)) = (&job.smtp_host, &job.smtp_user, &job.smtp_pass) {
            let port = job.smtp_port.unwrap_or(587);
            let creds = Credentials::new(user.clone(), pass.clone());
            let transport = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)?
                .credentials(creds)
                .port(port)
                .timeout(Some(self.timeout))
                .build();
            transport.send(email).await?;
        } else {
            anyhow::bail!("EmailJob has no SMTP credentials and no fallback SMTP_HOST configured");
        }
        Ok(())
    }
}
