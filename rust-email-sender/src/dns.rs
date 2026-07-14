use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use anyhow::Result;
use dashmap::DashMap;
use trust_dns_resolver::TokioAsyncResolver;
use trust_dns_resolver::config::*;

#[derive(Debug, Clone)]
pub struct MxRecord {
    pub exchange: String,
    pub priority: u16,
}

struct CachedEntry {
    records: Vec<MxRecord>,
    inserted_at: Instant,
}

pub struct CachedResolver {
    resolver: TokioAsyncResolver,
    cache: DashMap<String, CachedEntry>,
    ttl: Duration,
}

impl CachedResolver {
    pub async fn new() -> Result<Arc<Self>> {
        let resolver = TokioAsyncResolver::tokio(
            ResolverConfig::default(),
            ResolverOpts::default(),
        ).await?;

        Ok(Arc::new(Self {
            resolver,
            cache: DashMap::new(),
            ttl: Duration::from_secs(300), // 5 minutes
        }))
    }

    pub async fn resolve_mx(&self, domain: &str) -> Result<Vec<MxRecord>> {
        // Check cache
        if let Some(entry) = self.cache.get(domain) {
            if entry.inserted_at.elapsed() < self.ttl {
                return Ok(entry.records.clone());
            }
        }

        // Resolve MX records
        let response = self.resolver.mx_lookup(domain).await?;
        let mut records: Vec<MxRecord> = response.iter()
            .map(|mx| MxRecord {
                exchange: mx.exchange().to_string().trim_end_matches('.').to_string(),
                priority: mx.preference(),
            })
            .collect();

        // Sort by priority (lowest first)
        records.sort_by_key(|r| r.priority);

        // Cache the result
        self.cache.insert(domain.to_string(), CachedEntry {
            records: records.clone(),
            inserted_at: Instant::now(),
        });

        Ok(records)
    }
}
