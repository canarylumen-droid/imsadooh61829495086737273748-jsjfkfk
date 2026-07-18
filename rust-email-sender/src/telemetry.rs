use std::time::Duration;
use anyhow::Result;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::Instant;
use log::debug;

#[derive(Debug, Clone)]
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

pub struct SmtpTelemetry;

impl SmtpTelemetry {
    pub async fn probe(
        recipient_email: &str,
        sender_domain: &str,
        mx_host: &str,
    ) -> Result<TelemetryReport> {
        let addr = format!("{}:25", mx_host);

        let start_connect = Instant::now();
        let stream = tokio::time::timeout(
            Duration::from_secs(5),
            TcpStream::connect(&addr),
        ).await??;
        let connect_latency_ms = start_connect.elapsed().as_millis();

        let mut reader = BufReader::new(stream);
        let mut line = String::new();

        reader.read_line(&mut line).await?;
        debug!("Banner: {}", line.trim());
        line.clear();

        let start_handshake = Instant::now();

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

        let start_rcpt = Instant::now();
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
