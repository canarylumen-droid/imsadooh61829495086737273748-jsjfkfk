use mail_parser::MessageParser;
use anyhow::Result;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ParsedEmail {
    pub message_id: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub subject: Option<String>,
    pub date: Option<String>,
    pub text_body: Option<String>,
    pub html_body: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub headers: Vec<(String, String)>,
}

pub fn parse_email(raw: &str) -> Result<ParsedEmail> {
    let parser = MessageParser::default();

    let message = parser.parse(raw.as_bytes())
        .ok_or_else(|| anyhow::anyhow!("Failed to parse email"))?;

    Ok(ParsedEmail {
        message_id: message.message_id().map(|s| s.to_string()),
        from: message.from().and_then(|addr| {
            addr.iter().next().map(|a| {
                match a {
                    mail_parser::HeaderValue::Address(addr) => {
                        if let Some(name) = addr.name() {
                            format!("{} <{}>", name, addr.address())
                        } else {
                            addr.address().to_string()
                        }
                    }
                    _ => String::new(),
                }
            })
        }),
        to: message.to().and_then(|addr| {
            addr.iter().next().map(|a| {
                match a {
                    mail_parser::HeaderValue::Address(addr) => {
                        addr.address().to_string()
                    }
                    _ => String::new(),
                }
            })
        }),
        subject: message.subject().map(|s| s.to_string()),
        date: message.date().map(|d| d.to_string()),
        text_body: message.text_body().map(|s| s.to_string()),
        html_body: message.html_body().map(|s| s.to_string()),
        in_reply_to: message.in_reply_to().map(|s| s.to_string()),
        references: message.references().map(|s| s.to_string()),
        headers: Vec::new(), // Simplified — in production, extract custom headers
    })
}

pub fn is_bounce(raw: &str) -> bool {
    let lower = raw.to_lowercase();

    // Check for common bounce indicators
    lower.contains("delivery-status") ||
    lower.contains("mail-delivery-subsystem") ||
    lower.contains("mailer-daemon") ||
    lower.contains("postmaster") ||
    lower.contains("undeliverable") ||
    lower.contains("delivery failure") ||
    lower.contains("returned mail") ||
    lower.contains("failure notice")
}

pub fn extract_bounce_recipient(raw: &str) -> Option<String> {
    // Look for Original-Recipient or Final-Recipient headers
    for line in raw.lines() {
        let lower = line.to_lowercase();
        if lower.contains("original-recipient:") || lower.contains("final-recipient:") {
            if let Some(addr) = line.split(':').nth(2) {
                return Some(addr.trim().to_string());
            }
        }
    }

    // Fallback: look for the recipient in the bounce body
    if let Some(start) = raw.find("recipient:") {
        let rest = &raw[start + 10..];
        if let Some(end) = rest.find('\n') {
            return Some(rest[..end].trim().to_string());
        }
    }

    None
}
