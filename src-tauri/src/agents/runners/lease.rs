//! The budget a run may spend before asking the server for more. The server
//! reserves tokens from the person's weekly allowance and signs a lease; the
//! device stops the tool at the next turn boundary once the lease is spent or
//! expired, and never starts a turn without one.
use serde::{Deserialize, Serialize};

use super::events::Usage;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Lease {
    pub invocation_id: String,
    /// Universal tokens the run may spend under this lease.
    pub token_budget: u64,
    /// Unix seconds.
    pub expires_at: i64,
    /// The grant set version the lease was issued with.
    pub grant_version: i64,
    /// The person's remembered actions for this project, carried with the lease.
    #[serde(default)]
    pub grants: Vec<String>,
    /// The server's signature over the lease, checked before use.
    #[serde(default)]
    pub signature: String,
}

/// Tracks spending against the current lease.
#[derive(Debug, Clone, Default)]
pub struct LeaseMeter {
    lease: Option<Lease>,
    spent: u64,
}

impl LeaseMeter {
    pub fn new(lease: Lease) -> Self {
        Self { lease: Some(lease), spent: 0 }
    }

    pub fn lease(&self) -> Option<&Lease> {
        self.lease.as_ref()
    }

    /// Valid when there is a lease, it has not expired and budget is left.
    pub fn valid(&self, now: i64) -> bool {
        self.lease.as_ref().is_some_and(|lease| now < lease.expires_at && self.spent < lease.token_budget)
    }

    /// Records a turn's usage; returns whether the next turn may start.
    pub fn record(&mut self, usage: &Usage, now: i64) -> bool {
        self.spent = self.spent.saturating_add(usage.total());
        self.valid(now)
    }

    pub fn spent(&self) -> u64 {
        self.spent
    }

    /// Replaces a spent lease with a new one from the server.
    pub fn renew(&mut self, lease: Lease) {
        self.lease = Some(lease);
        self.spent = 0;
    }
}
