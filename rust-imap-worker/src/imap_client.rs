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

        // Read server greeting
        self.read_response().await?;
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

    pub async fn fetch(&mut self, last_uid: u32) -> Result<String> {
        self.idle_done().await?;
        let tag = self.next_tag();
        let cmd = format!("{} FETCH {}:* (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])\r\n", tag, last_uid + 1);
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
