use std::sync::Arc;
use std::time::{Duration, Instant};
use anyhow::Result;
use dashmap::DashMap;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::Instant as TokioInstant;
use log::debug;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlacementGuess {
    InboxConfident,
    TarpittedSpamQueue,
    GreylistedOrThrottled,
    Rejected,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct TelemetryReport {
    pub mx_host: String,
    pub connect_latency_ms: u128,
    pub rcpt_latency_ms: u128,
    pub handshake_latency_ms: u128,
    pub last_smtp_code: u16,
    pub raw_response: String,
    pub suspected_placement: PlacementGuess,
}

pub struct SmtpTelemetry {
    cache: DashMap<String, TelemetryCacheEntry>,
    ttl: Duration,
}

struct TelemetryCacheEntry {
    report: TelemetryReport,
    inserted_at: Instant,
}

impl SmtpTelemetry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            cache: DashMap::new(),
            ttl: Duration::from_secs(300), // 5-minute cache per MX host
        })
    }

    pub async fn probe(
        self: &Arc<Self>,
        recipient_email: &str,
        sender_domain: &str,
        mx_host: &str,
    ) -> Result<TelemetryReport> {
        let cache_key = mx_host.to_string();

        // Check cache first
        if let Some(entry) = self.cache.get(&cache_key) {
            if entry.inserted_at.elapsed() < self.ttl {
                return Ok(entry.report.clone());
            }
        }

        let report = Self::probe_raw(recipient_email, sender_domain, mx_host).await?;

        self.cache.insert(cache_key, TelemetryCacheEntry {
            report: report.clone(),
            inserted_at: Instant::now(),
        });

        Ok(report)
    }

    async fn probe_raw(
        recipient_email: &str,
        sender_domain: &str,
        mx_host: &str,
    ) -> Result<TelemetryReport> {
        // Note: AWS EC2 blocks outbound port 25 by default.
        // Port 587 (submission) is used as a best-effort alternative.
        // MX hosts typically only listen on :25, so telemetry may fail
        // for many providers from EC2. This is non-fatal — placement
        // is determined by post-send signals (opens, bounces, seed monitor).
        let addr = format!("{}:587", mx_host);

        let start_connect = TokioInstant::now();
        let stream = tokio::time::timeout(
            Duration::from_secs(2),
            TcpStream::connect(&addr),
        ).await??;
        let connect_latency_ms = start_connect.elapsed().as_millis();

        let mut reader = BufReader::new(stream);
        let mut line = String::new();

        reader.read_line(&mut line).await?;
        debug!("Banner: {}", line.trim());
        line.clear();

        let start_handshake = TokioInstant::now();

        reader.get_mut().write_all(format!("EHLO {}\r\n", sender_domain).as_bytes()).await?;
        loop {
            reader.read_line(&mut line).await?;
            if line.len() >= 4 && line.as_bytes()[3] == b' ' { break; }
            line.clear();
        }
        line.clear();

        reader.get_mut().write_all(format!("MAIL FROM:<telemetry@{}>\r\n", sender_domain).as_bytes()).await?;
        reader.read_line(&mut line).await?;
        line.clear();

        let start_rcpt = TokioInstant::now();
        reader.get_mut().write_all(format!("RCPT TO:<{}>\r\n", recipient_email).as_bytes()).await?;
        reader.read_line(&mut line).await?;
        let rcpt_latency_ms = start_rcpt.elapsed().as_millis();
        let handshake_latency_ms = start_handshake.elapsed().as_millis();

        let smtp_code: u16 = line.get(0..3).unwrap_or("000").parse().unwrap_or(0);

        let _ = reader.get_mut().write_all(b"QUIT\r\n").await;

        let suspected_placement = match smtp_code {
            250 | 251 => {
                if rcpt_latency_ms > 1200 {
                    PlacementGuess::TarpittedSpamQueue
                } else {
                    PlacementGuess::InboxConfident
                }
            }
            450 | 451 | 452 => PlacementGuess::GreylistedOrThrottled,
            550 | 554 => PlacementGuess::Rejected,
            _ => PlacementGuess::Unknown,
        };

        Ok(TelemetryReport {
            mx_host: mx_host.to_string(),
            connect_latency_ms,
            rcpt_latency_ms,
            handshake_latency_ms,
            last_smtp_code: smtp_code,
            raw_response: line.trim().to_string(),
            suspected_placement,
        })
    }
}
