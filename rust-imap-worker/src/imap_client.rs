use std::sync::Arc;
use std::time::Duration;
use anyhow::{Result, Context};
use tokio::net::TcpStream;
use tokio_rustls::{TlsConnector, client::TlsStream};
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use imap_codec::protocol::parser::parse_response;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use bytes::BytesMut;
use log::{debug, warn, error};

pub struct ImapConnection {
    stream: Option<TlsStream<TcpStream>>,
    tag_counter: u32,
    buffer: BytesMut,
    pub is_authenticated: bool,
    pub is_idle: bool,
    pub last_activity: std::time::Instant,
    pub folder: String,
}

impl ImapConnection {
    pub fn new(folder: String) -> Self {
        Self {
            stream: None,
            tag_counter: 0,
            buffer: BytesMut::with_capacity(8192),
            is_authenticated: false,
            is_idle: false,
            last_activity: std::time::Instant::now(),
            folder,
        }
    }

    fn next_tag(&mut self) -> String {
        self.tag_counter += 1;
        format!("A{:04}", self.tag_counter)
    }

    pub async fn connect(&mut self, host: &str, port: u16, use_tls: bool) -> Result<()> {
        let tcp = tokio::time::timeout(
            Duration::from_secs(15),
            TcpStream::connect(format!("{}:{}", host, port)),
        ).await
            .context("TCP connection timeout")?
            .context("TCP connection failed")?;

        if use_tls {
            let mut root_store = RootCertStore::empty();
            root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

            let mut config = ClientConfig::builder()
                .with_root_certificates(root_store)
                .with_no_client_auth();

            config.alpn_protocols = vec![b"imap".to_vec()];

            let connector = TlsConnector::from(Arc::new(config));
            let domain = host.split(':').next().unwrap_or(host);
            let tls_stream = connector.connect(
                domain.try_into().context("Invalid TLS domain")?,
                tcp,
            ).await
                .context("TLS handshake failed")?;

            self.stream = Some(tls_stream);
        } else {
            // For non-TLS, we still wrap in a TlsStream-like type
            // In practice, always use TLS for IMAP
            anyhow::bail!("Non-TLS IMAP is not supported for security reasons");
        }

        // Read server greeting
        self.read_response().await?;

        self.last_activity = std::time::Instant::now();
        debug!("Connected to {}:{}", host, port);
        Ok(())
    }

    pub async fn authenticate(&mut self, username: &str, password: &str) -> Result<()> {
        let tag = self.next_tag();
        // Start TLS upgrade if not already
        let cmd = format!("{} LOGIN {} {}\r\n", tag, username, password);
        self.send_command(&cmd).await?;
        let response = self.read_response().await?;

        if response.contains(&format!("{} OK", tag)) {
            self.is_authenticated = true;
            debug!("Authentication successful for {}", username);
            Ok(())
        } else {
            error!("Authentication failed for {}: {}", username, response);
            anyhow::bail!("IMAP LOGIN failed: {}", response);
        }
    }

    pub async fn select(&mut self, folder: &str) -> Result<()> {
        let tag = self.next_tag();
        let cmd = format!("{} SELECT \"{}\"\r\n", tag, folder);
        self.send_command(&cmd).await?;
        let response = self.read_response().await?;

        if response.contains(&format!("{} OK", tag)) {
            self.folder = folder.to_string();
            debug!("Selected folder: {}", folder);
            Ok(())
        } else {
            anyhow::bail!("SELECT failed for {}: {}", folder, response);
        }
    }

    pub async fn idle(&mut self) -> Result<()> {
        let tag = self.next_tag();
        let cmd = format!("{} IDLE\r\n", tag);
        self.send_command(&cmd).await?;

        // Read "+ idling" continuation response
        let response = self.read_response().await?;
        if response.contains("+ idling") || response.contains("+ IDLE") {
            self.is_idle = true;
            self.last_activity = std::time::Instant::now();
            debug!("Entered IDLE mode on {}", self.folder);
            Ok(())
        } else {
            anyhow::bail!("IDLE command failed: {}", response);
        }
    }

    pub async fn idle_done(&mut self) -> Result<()> {
        if !self.is_idle {
            return Ok(());
        }

        // Send DONE to exit IDLE
        self.send_command("DONE\r\n").await?;
        let response = self.read_response().await?;
        self.is_idle = false;
        debug!("Exited IDLE mode on {}", self.folder);
        Ok(())
    }

    pub async fn fetch_new(&mut self, uid_validity: u32, last_uid: u32) -> Result<Vec<EmailHeader>> {
        // Exit IDLE first if active
        self.idle_done().await?;

        let tag = self.next_tag();
        // Fetch all messages with UID > last_uid
        let cmd = format!(
            "{} FETCH {}:* (UID FLAGS ENVELOPE)\r\n",
            tag, last_uid + 1
        );
        self.send_command(&cmd).await?;

        let mut emails = Vec::new();
        loop {
            let response = self.read_response().await?;

            // Parse FETCH responses
            if let Some(fetched) = parse_fetch_response(&response) {
                emails.extend(fetched);
            }

            // Check if we got the final OK
            if response.contains(&format!("{} OK", tag)) {
                break;
            }
        }

        self.last_activity = std::time::Instant::now();
        debug!("Fetched {} new emails from {}", emails.len(), self.folder);
        Ok(emails)
    }

    pub async fn fetch_body(&mut self, uid: u32) -> Result<String> {
        self.idle_done().await?;

        let tag = self.next_tag();
        let cmd = format!("{} FETCH {} BODY[]\r\n", tag, uid);
        self.send_command(&cmd).await?;

        let mut body = String::new();
        loop {
            let response = self.read_response().await?;
            body.push_str(&response);

            if response.contains(&format!("{} OK", tag)) {
                break;
            }
        }

        self.last_activity = std::time::Instant::now();
        Ok(body)
    }

    pub async fn noop(&mut self) -> Result<()> {
        let tag = self.next_tag();
        let cmd = format!("{} NOOP\r\n", tag);
        self.send_command(&cmd).await?;
        self.read_response().await?;
        self.last_activity = std::time::Instant::now();
        Ok(())
    }

    pub async fn logout(&mut self) -> Result<()> {
        let tag = self.next_tag();
        let cmd = format!("{} LOGOUT\r\n", tag);
        let _ = self.send_command(&cmd).await;
        let _ = self.read_response().await;
        self.is_authenticated = false;
        self.is_idle = false;
        Ok(())
    }

    async fn send_command(&mut self, cmd: &str) -> Result<()> {
        if let Some(stream) = &mut self.stream {
            stream.write_all(cmd.as_bytes()).await
                .context("Failed to send IMAP command")?;
            stream.flush().await
                .context("Failed to flush IMAP stream")?;
            Ok(())
        } else {
            anyhow::bail!("Not connected")
        }
    }

    async fn read_response(&mut self) -> Result<String> {
        if let Some(stream) = &mut self.stream {
            self.buffer.clear();
            let mut temp = [0u8; 8192];

            loop {
                let n = tokio::time::timeout(
                    Duration::from_secs(30),
                    stream.read(&mut temp),
                ).await
                    .context("Read timeout")?
                    .context("Read error")?;

                if n == 0 {
                    break;
                }

                self.buffer.extend_from_slice(&temp[..n]);
                let response = String::from_utf8_lossy(&self.buffer).to_string();

                // Check if we have a complete response
                if is_complete_response(&response) {
                    return Ok(response);
                }
            }

            Ok(String::from_utf8_lossy(&self.buffer).to_string())
        } else {
            anyhow::bail!("Not connected")
        }
    }

    pub fn is_zombie(&self, timeout: Duration) -> bool {
        self.last_activity.elapsed() > timeout
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EmailHeader {
    pub uid: u32,
    pub message_id: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub subject: Option<String>,
    pub date: Option<String>,
    pub flags: Vec<String>,
}

fn is_complete_response(response: &str) -> bool {
    let lines: Vec<&str> = response.lines().collect();
    if let Some(last_line) = lines.last() {
        // A tagged response like "A001 OK" or continuation "+ ..."
        let trimmed = last_line.trim();
        if trimmed.starts_with('A') && trimmed.contains("OK") {
            return true;
        }
        if trimmed.starts_with('A') && trimmed.contains("NO") {
            return true;
        }
        if trimmed.starts_with('A') && trimmed.contains("BAD") {
            return true;
        }
    }
    false
}

fn parse_fetch_response(response: &str) -> Option<Vec<EmailHeader>> {
    let mut emails = Vec::new();

    // Simple parser for FETCH responses
    // Format: * 123 FETCH (UID 456 FLAGS (\Seen) ENVELOPE ...)
    for line in response.lines() {
        if line.contains("FETCH") && line.contains("UID") {
            if let Some(uid) = extract_uid(line) {
                emails.push(EmailHeader {
                    uid,
                    message_id: None,
                    from: extract_envelope_field(line, "FROM"),
                    to: extract_envelope_field(line, "TO"),
                    subject: extract_envelope_field(line, "SUBJECT"),
                    date: extract_envelope_field(line, "DATE"),
                    flags: extract_flags(line),
                });
            }
        }
    }

    if emails.is_empty() {
        None
    } else {
        Some(emails)
    }
}

fn extract_uid(line: &str) -> Option<u32> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    for (i, part) in parts.iter().enumerate() {
        if *part == "UID" && i + 1 < parts.len() {
            return parts[i + 1].parse().ok();
        }
    }
    None
}

fn extract_envelope_field(line: &str, field: &str) -> Option<String> {
    if let Some(start) = line.find(field) {
        let rest = &line[start..];
        // Simple extraction — in production, use proper IMAP response parser
        if let Some(paren_start) = rest.find('(') {
            if let Some(paren_end) = rest[paren_start..].find(')') {
                return Some(rest[paren_start + 1..paren_start + paren_end].to_string());
            }
        }
    }
    None
}

fn extract_flags(line: &str) -> Vec<String> {
    if let Some(start) = line.find("FLAGS") {
        let rest = &line[start..];
        if let Some(paren_start) = rest.find('(') {
            if let Some(paren_end) = rest[paren_start..].find(')') {
                return rest[paren_start + 1..paren_start + paren_end]
                    .split_whitespace()
                    .map(|s| s.to_string())
                    .collect();
            }
        }
    }
    Vec::new()
}
