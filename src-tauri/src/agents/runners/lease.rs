//! The server-signed lease a coding run works under: the grants the person
//! remembered for this project and how long they hold. The device never starts
//! a turn without a current lease and stops the tool at the next turn boundary
//! once it expires.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Lease {
    pub invocation_id: String,
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

/// Tracks whether the current lease still holds.
#[derive(Debug, Clone, Default)]
pub struct LeaseMeter {
    lease: Option<Lease>,
}

impl LeaseMeter {
    pub fn new(lease: Lease) -> Self {
        Self { lease: Some(lease) }
    }

    /// Valid when there is a lease and it has not expired.
    pub fn valid(&self, now: i64) -> bool {
        self.lease.as_ref().is_some_and(|lease| now < lease.expires_at)
    }
}
