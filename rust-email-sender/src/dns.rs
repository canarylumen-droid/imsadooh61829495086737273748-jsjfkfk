use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use anyhow::Result;
use dashmap::DashMap;
use trust_dns_resolver::TokioAsyncResolver;
use trust_dns_resolver::config::*;
use trust_dns_resolver::proto::rr::RecordType;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MxRecord {
    pub exchange: String,
    pub priority: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpfResult {
    pub found: bool,
    pub valid: bool,
    pub record: Option<String>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkimResult {
    pub found: bool,
    pub valid: bool,
    pub selector: Option<String>,
    pub record: Option<String>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmarcResult {
    pub found: bool,
    pub valid: bool,
    pub policy: Option<String>,
    pub record: Option<String>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlacklistResult {
    pub is_blacklisted: bool,
    pub listed_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsVerificationResult {
    pub domain: String,
    pub spf: SpfResult,
    pub dkim: DkimResult,
    pub dmarc: DmarcResult,
    pub mx: Vec<MxRecord>,
    pub mx_found: bool,
    pub blacklist: BlacklistResult,
    pub overall_score: u32,
    pub overall_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsJob {
    pub job_id: String,
    pub user_id: String,
    pub domain: String,
    pub dkim_selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsJobResult {
    pub job_id: String,
    pub user_id: String,
    pub result: DnsVerificationResult,
    pub error: Option<String>,
    pub timestamp: String,
}

struct CachedEntry {
    result: DnsVerificationResult,
    inserted_at: Instant,
}

pub struct DnsResolver {
    resolver: TokioAsyncResolver,
    cache: DashMap<String, CachedEntry>,
    ttl: Duration,
}

impl DnsResolver {
    pub async fn new() -> Result<Arc<Self>> {
        let mut resolver_opts = ResolverOpts::default();
        resolver_opts.use_hosts_file = false;
        resolver_opts.ip_strategy = IpStrategy::Ipv4Only;

        let resolver = TokioAsyncResolver::tokio(
            ResolverConfig::default(),
            resolver_opts,
        ).await?;

        Ok(Arc::new(Self {
            resolver,
            cache: DashMap::new(),
            ttl: Duration::from_secs(300),
        }))
    }

    pub async fn resolve_mx(&self, domain: &str) -> Result<Vec<MxRecord>> {
        let cache_key = format!("mx:{}", domain);
        if let Some(entry) = self.cache.get(&cache_key) {
            if entry.inserted_at.elapsed() < self.ttl {
                return Ok(entry.result.mx.clone());
            }
        }

        let response = self.resolver.mx_lookup(domain).await?;
        let mut records: Vec<MxRecord> = response.iter()
            .map(|mx| MxRecord {
                exchange: mx.exchange().to_string().trim_end_matches('.').to_string(),
                priority: mx.preference(),
            })
            .collect();
        records.sort_by_key(|r| r.priority);

        // Create a partial DnsVerificationResult for caching the MX records
        let partial = DnsVerificationResult {
            domain: domain.to_string(),
            mx: records.clone(),
            mx_found: !records.is_empty(),
            spf: SpfResult { found: false, valid: false, record: None, issues: vec![] },
            dkim: DkimResult { found: false, valid: false, selector: None, record: None, issues: vec![] },
            dmarc: DmarcResult { found: false, valid: false, policy: None, record: None, issues: vec![] },
            blacklist: BlacklistResult { is_blacklisted: false, listed_on: vec![] },
            overall_score: 0,
            overall_status: "unknown".to_string(),
        };
        self.cache.insert(cache_key, CachedEntry {
            result: partial,
            inserted_at: Instant::now(),
        });

        Ok(records)
    }

    async fn resolve_txt(&self, name: &str) -> Result<Vec<String>> {
        let response = self.resolver.txt_lookup(name).await?;
        Ok(response.iter()
            .flat_map(|rr| rr.txt_data().iter().map(|s| s.to_string()))
            .collect())
    }

    async fn check_spf(&self, domain: &str) -> SpfResult {
        let mut issues = Vec::new();
        match self.resolve_txt(domain).await {
            Ok(records) => {
                let spf: Vec<String> = records.into_iter()
                    .filter(|r| r.to_lowercase().starts_with("v=spf1"))
                    .collect();

                if spf.is_empty() {
                    return SpfResult {
                        found: false, valid: false, record: None,
                        issues: vec!["No SPF record found".into()],
                    };
                }

                let record = spf[0].clone();
                if spf.len() > 1 {
                    issues.push("Multiple SPF records found".into());
                }
                if !record.contains("~all") && !record.contains("-all") && !record.contains("?all") {
                    issues.push("SPF missing all mechanism".into());
                }
                if record.contains("+all") {
                    issues.push("SPF uses +all (allows any sender)".into());
                }

                let lookups = record.matches(|c: char| matches!(c, 'a'|'m'|'p'|'e'|'i')).count();
                if lookups > 10 {
                    issues.push(format!("Too many DNS lookups: {}", lookups));
                }

                SpfResult {
                    found: true,
                    valid: issues.is_empty(),
                    record: Some(record),
                    issues,
                }
            }
            Err(_) => SpfResult {
                found: false, valid: false, record: None,
                issues: vec!["DNS resolution failed".into()],
            }
        }
    }

    async fn check_dkim(&self, domain: &str, selector: &Option<String>) -> DkimResult {
        let selectors: Vec<&str> = if let Some(s) = selector {
            vec![s.as_str()]
        } else {
            vec!["default", "google", "selector1", "selector2", "k1", "dkim", "mail", "smtp"]
        };

        for sel in &selectors {
            let name = format!("{}._domainkey.{}", sel, domain);
            if let Ok(records) = self.resolve_txt(&name).await {
                let joined: String = records.join("");
                if joined.to_lowercase().contains("v=dkim1") {
                    let mut issues = Vec::new();
                    if !joined.contains("p=") {
                        issues.push("DKIM missing public key".into());
                    }
                    return DkimResult {
                        found: true,
                        valid: issues.is_empty(),
                        selector: Some(sel.to_string()),
                        record: Some(joined),
                        issues,
                    };
                }
            }
        }

        DkimResult {
            found: false, valid: false, selector: None, record: None,
            issues: vec!["No DKIM record found".into()],
        }
    }

    async fn check_dmarc(&self, domain: &str) -> DmarcResult {
        let name = format!("_dmarc.{}", domain);
        match self.resolve_txt(&name).await {
            Ok(records) => {
                let dmarc: Vec<String> = records.into_iter()
                    .filter(|r| r.to_lowercase().starts_with("v=dmarc1"))
                    .collect();

                if dmarc.is_empty() {
                    return DmarcResult {
                        found: false, valid: false, policy: None, record: None,
                        issues: vec!["No DMARC record found".into()],
                    };
                }

                let record = dmarc[0].clone();
                let mut issues = Vec::new();
                let policy = record.split(';')
                    .find_map(|part| {
                        let p = part.trim();
                        if p.to_lowercase().starts_with("p=") {
                            Some(p[2..].to_lowercase())
                        } else { None }
                    });

                if policy.as_deref() == Some("none") {
                    issues.push("DMARC policy is p=none (monitoring only)".into());
                }

                DmarcResult {
                    found: true,
                    valid: issues.is_empty(),
                    policy,
                    record: Some(record),
                    issues,
                }
            }
            Err(_) => DmarcResult {
                found: false, valid: false, policy: None, record: None,
                issues: vec!["DNS resolution failed".into()],
            }
        }
    }

    async fn check_blacklist(&self, domain: &str) -> BlacklistResult {
        let blacklists = [
            "zen.spamhaus.org",
            "bl.spamcop.net",
            "dnsbl.sorbs.net",
            "b.barracudacentral.org",
            "psbl.surriel.com",
        ];
        let mut listed_on = Vec::new();

        if let Ok(ips) = self.resolver.ipv4_lookup(domain).await {
            for ip in ips.iter() {
                let ip_str = ip.to_string();
                let reversed: String = ip_str.split('.')
                    .rev()
                    .collect::<Vec<&str>>()
                    .join(".");
                for bl in &blacklists {
                    let query = format!("{}.{}", reversed, bl);
                    if self.resolver.ipv4_lookup(&query).await.is_ok() {
                        listed_on.push(bl.to_string());
                    }
                }
            }
        }

        // Domain-based RBLs
        for bl in &["multi.surbl.org", "dbl.spamhaus.org"] {
            let query = format!("{}.{}", domain, bl);
            if self.resolver.ipv4_lookup(&query).await.is_ok() {
                listed_on.push(bl.to_string());
            }
        }

        BlacklistResult {
            is_blacklisted: !listed_on.is_empty(),
            listed_on,
        }
    }

    pub async fn verify_domain(&self, domain: &str, dkim_selector: &Option<String>) -> DnsVerificationResult {
        let cache_key = format!("verify:{}:{:?}", domain, dkim_selector);
        if let Some(entry) = self.cache.get(&cache_key) {
            if entry.inserted_at.elapsed() < self.ttl {
                return entry.result.clone();
            }
        }

        let (spf, dkim, dmarc, mx, blacklist) = tokio::join!(
            self.check_spf(domain),
            self.check_dkim(domain, dkim_selector),
            self.check_dmarc(domain),
            self.resolve_mx(domain),
            self.check_blacklist(domain),
        );

        let mx_found = !mx.is_empty();
        let mut score = 0u32;

        if spf.found && spf.valid { score += 28; }
        else if spf.found { score += 16; }
        if dkim.found && dkim.valid { score += 28; }
        else if dkim.found { score += 16; }
        if dmarc.found {
            score += match dmarc.policy.as_deref() {
                Some("reject") => 27,
                Some("quarantine") => 24,
                _ => 20,
            };
        }
        if mx_found { score += 17; }

        if blacklist.is_blacklisted {
            score = (score as f64 * 0.7) as u32;
        }

        let status = if blacklist.is_blacklisted { "blacklisted" }
            else if score >= 90 { "excellent" }
            else if score >= 75 { "good" }
            else if score >= 50 { "fair" }
            else { "poor" };

        let result = DnsVerificationResult {
            domain: domain.to_string(),
            spf, dkim, dmarc,
            mx: mx.unwrap_or_default(),
            mx_found,
            blacklist,
            overall_score: score.min(100),
            overall_status: status.to_string(),
        };

        self.cache.insert(cache_key, CachedEntry {
            result: result.clone(),
            inserted_at: Instant::now(),
        });

        result
    }
}
