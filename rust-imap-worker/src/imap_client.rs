use std::sync::Arc;
use std::time::Duration;
use anyhow::{Result, Context};
use tokio::net::TcpStream;
use tokio_rustls::{TlsConnector, client::TlsStream};
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
            buffer: BytesMut::with_capacity(16384),
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
        let addr = format!("{}:{}", host, port);
        let tcp = tokio::time::timeout(
            Duration::from_secs(15),
            TcpStream::connect(&addr),
        ).await
            .context("TCP connection timeout")?
            .context("TCP connection failed")?;

        if use_tls {
            let mut root_store = tokio_rustls::rustls::RootCertStore::empty();
            root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

            let config = tokio_rustls::rustls::ClientConfig::builder()
                .with_root_certificates(root_store)
                .with_no_client_auth();

            let connector = TlsConnector::from(Arc::new(config));
            let domain_str = host.split(':').next().unwrap_or(host).to_string();
            let domain = tokio_rustls::rustls::pki_types::ServerName::try_from(domain_str)
                .map_err(|_| anyhow::anyhow!("Invalid TLS domain"))?;
            let tls_stream = connector.connect(domain, tcp).await
                .context("TLS handshake failed")?;

            self.stream = Some(tls_stream);
        } else {
            anyhow::bail!("Non-TLS IMAP is not supported for security reasons");
        }

        self.buffer.clear();
        let greeting = self.read_raw().await?;
        if !greeting.contains("* OK") && !greeting.contains("* PREAUTH") {
            warn!("Unexpected server greeting: {}", greeting.trim());
        }
        self.last_activity = std::time::Instant::now();
        debug!("Connected to {}:{}", host, port);
        Ok(())
    }

    pub async fn authenticate(&mut self, username: &str, password: &str) -> Result<()> {
        let tag = self.next_tag();
        let cmd = format!("{} LOGIN \"{}\" \"{}\"\r\n", tag, username, password);
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

    pub async fn select(&mut self, folder: &str) -> Result<String> {
        let tag = self.next_tag();
        let cmd = format!("{} SELECT \"{}\"\r\n", tag, folder);
        self.send_command(&cmd).await?;
        let response = self.read_response().await?;

        if response.contains(&format!("{} OK", tag)) {
            self.folder = folder.to_string();
            debug!("Selected folder: {}", folder);
            Ok(response)
        } else {
            anyhow::bail!("SELECT failed for {}: {}", folder, response);
        }
    }

    /// Extract UIDNEXT from SELECT response — the next UID to be assigned.
    /// Returns 0 if not found (fallback: use fetch from 1).
    pub fn get_uidnext(&self, response: &str) -> u32 {
        for line in response.lines() {
            let lower = line.trim().to_lowercase();
            if let Some(pos) = lower.find("uidnext") {
                let after = &lower[pos + 7..].trim();
                if let Some(space) = after.find(' ') {
                    if let Ok(uid) = after[..space].trim().parse::<u32>() {
                        return uid;
                    }
                }
            }
        }
        0
    }

    /// Extract UIDVALIDITY from SELECT response.
    pub fn get_uidvalidity(&self, response: &str) -> u32 {
        for line in response.lines() {
            let lower = line.trim().to_lowercase();
            if let Some(pos) = lower.find("uidvalidity") {
                let after = &lower[pos + 11..].trim();
                if let Some(space) = after.find(' ') {
                    if let Ok(uid) = after[..space].trim().parse::<u32>() {
                        return uid;
                    }
                }
            }
        }
        0
    }

    pub async fn idle(&mut self) -> Result<()> {
        let tag = self.next_tag();
        let cmd = format!("{} IDLE\r\n", tag);
        self.send_command(&cmd).await?;

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
        self.send_command("DONE\r\n").await?;
        let _ = self.read_response().await;
        self.is_idle = false;
        debug!("Exited IDLE mode on {}", self.folder);
        Ok(())
    }

    /// Wait for an IDLE push notification from the server.
    /// In IDLE mode, the server sends untagged lines like "* N EXISTS".
    /// This reads data until we detect EXISTS/RECENT or hit the timeout.
    /// Returns the raw data received, or empty string on timeout.
    pub async fn wait_for_idle_push(&mut self, timeout_secs: u64) -> Result<String> {
        if !self.is_idle || self.stream.is_none() {
            anyhow::bail!("Not in IDLE mode");
        }
        let stream = self.stream.as_mut().unwrap();
        let mut temp = [0u8; 16384];

        loop {
            let read_fut = stream.read(&mut temp);
            match tokio::time::timeout(Duration::from_secs(timeout_secs), read_fut).await {
                Ok(Ok(n)) if n > 0 => {
                    self.last_activity = std::time::Instant::now();
                    let data = String::from_utf8_lossy(&temp[..n]).to_string();
                    debug!("IDLE push received: {} bytes", n);

                    if data.contains("EXISTS") || data.contains("RECENT") {
                        return Ok(data);
                    }
                    // Keep waiting — the server may send multiple untagged lines
                }
                Ok(Ok(_)) => {
                    // Connection closed
                    anyhow::bail!("IMAP connection closed during IDLE");
                }
                Ok(Err(e)) => {
                    anyhow::bail!("IDLE read error: {}", e);
                }
                Err(_) => {
                    // Timeout — recycle time
                    debug!("IDLE timeout after {}s", timeout_secs);
                    return Ok(String::new());
                }
            }
        }
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

    /// Fetch headers for all messages from last_uid+1 onwards.
    pub async fn fetch(&mut self, last_uid: u32) -> Result<String> {
        self.idle_done().await?;
        let tag = self.next_tag();
        let cmd = format!("{} FETCH {}:* (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES CONTENT-TYPE)])\r\n", tag, last_uid + 1);
        self.send_command(&cmd).await?;
        let mut data = String::new();
        loop {
            let response = self.read_response().await?;
            data.push_str(&response);
            if response.contains(&format!("{} OK", tag)) {
                break;
            }
        }
        self.last_activity = std::time::Instant::now();
        Ok(data)
    }

    /// Fetch the full email (headers + body) for a specific UID.
    /// Returns raw IMAP response with full RFC822 content.
    pub async fn fetch_full(&mut self, uid: u32) -> Result<String> {
        self.idle_done().await?;
        let tag = self.next_tag();
        let cmd = format!("{} UID FETCH {} (UID FLAGS BODY[] INTERNALDATE)\r\n", tag, uid);
        self.send_command(&cmd).await?;
        let mut data = String::new();
        loop {
            let response = self.read_response().await?;
            data.push_str(&response);
            if response.contains(&format!("{} OK", tag)) {
                break;
            }
        }
        self.last_activity = std::time::Instant::now();
        Ok(data)
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

    async fn read_raw(&mut self) -> Result<String> {
        if let Some(stream) = &mut self.stream {
            let mut temp = [0u8; 8192];
            let n = tokio::time::timeout(
                Duration::from_secs(10),
                stream.read(&mut temp),
            ).await
                .context("Read timeout")?
                .context("Read error")?;
            if n > 0 {
                return Ok(String::from_utf8_lossy(&temp[..n]).to_string());
            }
            Ok(String::new())
        } else {
            anyhow::bail!("Not connected")
        }
    }

    async fn read_response(&mut self) -> Result<String> {
        if let Some(stream) = &mut self.stream {
            let mut temp = [0u8; 8192];
            loop {
                let n = tokio::time::timeout(
                    Duration::from_secs(30),
                    stream.read(&mut temp),
                ).await
                    .context("Read timeout")?
                    .context("Read error")?;
                if n == 0 { break; }
                self.buffer.extend_from_slice(&temp[..n]);
                let response = String::from_utf8_lossy(&self.buffer).to_string();
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

fn is_complete_response(response: &str) -> bool {
    let lines: Vec<&str> = response.lines().collect();
    if let Some(last_line) = lines.last() {
        let trimmed = last_line.trim();
        if trimmed.starts_with('A') && (trimmed.contains("OK") || trimmed.contains("NO") || trimmed.contains("BAD")) {
            return true;
        }
    }
    false
}
