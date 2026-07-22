# Rust Services

## Overview

Two Rust services handle performance-critical email operations: sending (SMTP) and monitoring (IMAP IDLE). Both are compiled binaries (~4-8MB) running under PM2.

## rust-email-sender

### Purpose
High-performance SMTP email sending with pre-send MX telemetry analysis.

### Binary
- **Size**: ~4.0MB compiled (release)
- **RAM**: ~4.8MB RSS
- **Language**: Rust (tokio async)
- **PM2 name**: `audnix-rust-email-sender`

### Architecture

```
Redis BRPOP email-send-queue
  → main.rs handler
    → Deserialize SendJob
    → MX telemetry (pre-send)
    → SMTP send via lettre
    → Publish result back to Redis
```

### Queue (main.rs)
```rust
// Event-driven: infinite block, zero polling
loop {
    let job: SendJob = brpop("email-send-queue", 0.0).await?;
    let result = send_email(&job).await;
    publish_result("email-send-results", &result).await;
}
```

### Config (config.rs)
```rust
struct Config {
    smtp_host: String,       // Default SMTP relay
    smtp_port: u16,          // 587 (STARTTLS)
    smtp_username: String,
    smtp_password: String,
    redis_url: String,
    email_send_queue: String,   // "email-send-queue"
    email_send_result_queue: String,
    mx_batch_queue: String,
    mx_batch_result_queue: String,
    max_connections: usize,     // Connection pool size
}
```

### Pre-Send MX Telemetry (telemetry.rs)
```rust
async fn analyze_mx(domain: &str) -> MxAnalysis {
    // Open raw TCP to MX port 25
    let mx = resolve_mx(domain).await?;
    let mut stream = TcpStream::connect((mx, 25)).await?;
    
    // EHLO
    stream.write_all(b"EHLO audnix\r\n").await?;
    let start = Instant::now();
    
    // MAIL FROM
    stream.write_all(b"MAIL FROM:<bounce@domain>\r\n").await?;
    
    // RCPT TO (timed)
    stream.write_all(b"RCPT TO:<test@domain>\r\n").await?;
    let elapsed = start.elapsed();
    
    let response = read_response(&mut stream).await?;
    
    classify(elapsed, response)
}
```

### Classification
| Timing | Response | Classification |
|---|---|---|
| RCPT < 200ms | 250 OK | `InboxConfident` |
| RCPT > 1200ms | 250 OK | `TarpittedSpamQueue` |
| Any | 4xx | `GreylistedOrThrottled` |
| Any | 5xx | `BouncedOrBlocked` |

### Compilation
```bash
cd rust-email-sender
cargo build --release
# Binary: target/release/rust-email-sender (~4.0MB)
```

## rust-imap-worker

### Purpose
IMAP IDLE monitoring for custom email mailboxes. Handles all `custom_email` type mailboxes (not Gmail/Outlook OAuth).

### Binary
- **Size**: ~7.7MB compiled (release)
- **RAM**: ~6.0MB RSS
- **Language**: Rust (tokio + async-imap)
- **PM2 name**: `audnix-rust-imap-worker`

### Architecture

```
Redis BRPOP mailbox-monitor:add
  → main.rs handler
    → Connect via IMAP (password auth)
    → Enter IDLE loop
    → On EXISTS notification: fetch new messages
    → Publish to Redis: NEW_EMAIL event

Redis BRPOP mailbox-monitor:remove
  → Disconnect IMAP
  → Clean up state
```

### Mailbox Monitor (mailbox_monitor.rs)
```rust
// Event-driven with BLPOP 0.0 (infinite block)
// One tokio task per mailbox
async fn monitor_mailbox(config: MailboxConfig) {
    let client = ImapClient::connect(&config).await?;
    
    loop {
        // IDLE with 60s push interval
        let exists = client.wait_for_idle_push(60).await?;
        
        if exists {
            // Fetch new messages > last_uid
            let messages = client.fetch_new(last_uid).await?;
            for msg in messages {
                publish_new_email(msg).await?;
            }
            last_uid = messages.last().unwrap().uid;
        }
        
        // Every 5 minutes, scan spam/promotions
        if elapsed_since_last_scan > 300 {
            scan_spam_promotions(&client).await?;
        }
    }
}
```

### Seed Monitor (seed_monitor.rs)
Specialized mailbox monitor for seed accounts (warmup recipients).

```rust
async fn scan_spam_promotions(client: &ImapClient) -> Result<()> {
    // Check Spam folder
    if let Some(msgs) = client.select_and_fetch("[Gmail]/Spam", last_spam_uid).await? {
        for msg in msgs {
            if has_warmup_header(&msg) {
                // Move to INBOX
                client.uid_move(msg.uid, "INBOX").await?;
                // Mark not spam
                client.mark_not_spam_and_important(msg.uid).await?;
                // Publish event
                publish_seed_placement(msg, "spam").await?;
            }
        }
    }
    
    // Check Promotions folder
    if let Some(msgs) = client.select_and_fetch("[Gmail]/Promotions", last_promotions_uid).await? {
        for msg in msgs {
            if has_warmup_header(&msg) {
                client.uid_move(msg.uid, "INBOX").await?;
                client.mark_not_spam_and_important(msg.uid).await?;
                publish_seed_placement(msg, "promotions").await?;
            }
        }
    }
}
```

### IMAP Client (imap_client.rs)
```rust
struct ImapClient {
    client: async_imap::Session<TlsStream<TcpStream>>,
}

impl ImapClient {
    async fn connect(config: &MailboxConfig) -> Result<Self>;
    async fn select_mailbox(&mut self, name: &str) -> Result<String>; // Returns UIDVALIDITY
    async fn wait_for_idle_push(&mut self, timeout_secs: u64) -> Result<bool>;
    async fn fetch_new(&mut self, last_uid: u32) -> Result<Vec<Message>>;
    async fn uid_move(&mut self, uid: u32, dest: &str) -> Result<()>;  // RFC 6851
    async fn uid_copy_and_delete(&mut self, uid: u32, dest: &str) -> Result<()>;  // Fallback
    async fn mark_not_spam_and_important(&mut self, uid: u32) -> Result<()>;  // \NotJunk \Flagged
    async fn logout(&mut self) -> Result<()>;
}
```

### UID MOVE (RFC 6851)
```rust
// Preferred: UID MOVE (RFC 6851)
async fn uid_move(&mut self, uid: u32, dest: &str) -> Result<()> {
    self.client
        .uid_store(uid, "+FLAGS (\\Deleted)").await?;
    self.client
        .uid_move(uid, dest).await?;
    self.client
        .expunge().await?;
}

// Fallback: UID COPY + UID STORE +FLAGS \Deleted
async fn uid_copy_and_delete(&mut self, uid: u32, dest: &str) -> Result<()> {
    self.client.uid_copy(uid, dest).await?;
    self.client
        .uid_store(uid, "+FLAGS (\\Deleted \\Seen)").await?;
    self.client.expunge().await?;
}
```

### IMAP Response Println Fix
- **Removed (Jul 22)**: Raw IMAP protocol `println!("Server response:\n{}", &data[..500])` was leaking raw IMAP responses to stdout
- Now only prints: `"✅ IMAP Test Successful!"`
- Prevents sensitive connection data from appearing in PM2 logs

## Interop with Node.js

### Queue Names
| Redis Queue | Consumer | Producer |
|---|---|---|
| `email-send-queue` | Rust email sender | Node.js (worker-email) |
| `email-send-results` | Node.js | Rust email sender |
| `mailbox-monitor:add` | Rust IMAP worker | Node.js (api-gateway) |
| `mailbox-monitor:remove` | Rust IMAP worker | Node.js (api-gateway) |
| `mx-batch-queue` | Rust email sender | Node.js (api-gateway) |
| `mx-batch-results` | Node.js | Rust email sender |

### Communication Pattern
```
Node.js → LPUSH to queue → Rust BRPOP 0.0
Rust processes → LPUSH result → Node.js BRPOP with timeout
Fallback: Node.js processes inline if Rust doesn't respond in time
```

### MX Batch Queue (50k leads)
```
Node.js:
  → Collect all unique domains from leads
  → LPUSH mx-batch-queue { domains: [...] }
  → BRPOP mx-batch-results 15s
  → If Rust responds: use results
  → Fallback: Promise.allSettled DNS in Node.js

Rust:
  → BRPOP mx-batch-queue 0.0
  → futures::future::join_all(resolve for each domain)
  → LPUSH mx-batch-results { results: { domain -> mx } }
```

## Deployment

### On EC2
```bash
# Compile Rust services
cd /home/ubuntu/app/rust-email-sender && cargo build --release
cd /home/ubuntu/app/rust-imap-worker && cargo build --release

# PM2 manages binaries
pm2 restart audnix-rust-email-sender audnix-rust-imap-worker

# Check status
pm2 status | grep rust
```

### Environment Variables
- All config passed via `ecosystem.config.cjs` env block
- Redis URL, queue names, SMTP credentials
- Rust services do NOT read `.env` files
- `SEED_MONITOR_EMAIL` / `SEED_MONITOR_PASSWORD` required for seed monitoring (currently not set — seed monitoring handled by Node.js fallback)
