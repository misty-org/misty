//! When queued changes are published. Edits are stored durably the moment
//! they are made; this only decides when a queue goes to the server, so a
//! burst of edits costs one request. What a request carries is unchanged: it
//! is the difference between the queued state and the server's, so edits that
//! cancel out never leave the machine.
//!
//! The server sends the base timings (`batch_policy`); the defaults here apply until
//! it does. This device's own sync frequency scales them (see `set_frequency`), so the
//! choice never leaves the device. Values from the server are clamped: a bad policy can
//! slow sync down, never stop it.
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::atomic::{AtomicU8, Ordering},
    time::{Duration, Instant},
};

use serde::Deserialize;

mod batcher;
pub use batcher::Batcher;

/// How long a workspace counts as edited by another machine after its last
/// change from one arrives.
const CONTENDED_FOR: Duration = Duration::from_secs(30);
/// Longest a server may hold back a queue after rejecting it for rate.
pub const MAX_HOLD: Duration = Duration::from_secs(300);

/// How eagerly this device sends its changes. It is a setting of this device alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Frequency {
    /// Sends sooner and in smaller bursts.
    Live,
    Balanced,
    /// Waits longer and sends bigger bursts.
    Saver,
}

static FREQUENCY: AtomicU8 = AtomicU8::new(1);

impl Frequency {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "live" => Some(Self::Live),
            "balanced" => Some(Self::Balanced),
            "saver" => Some(Self::Saver),
            _ => None,
        }
    }

    /// Multiplies quiet time, longest wait and burst size.
    fn scale(self) -> (f64, f64, f64) {
        match self {
            Self::Live => (0.25, 0.2, 0.5),
            Self::Balanced => (1.0, 1.0, 1.0),
            Self::Saver => (4.0, 6.0, 2.0),
        }
    }
}

/// Sets this device's sync frequency; an unknown name is ignored. It takes effect for
/// edits already queued, since every queue is judged against it when it is checked.
pub fn set_frequency(name: &str) -> bool {
    let Some(frequency) = Frequency::parse(name) else {
        return false;
    };
    FREQUENCY.store(frequency as u8, Ordering::Relaxed);
    true
}

/// How often a vault with no open window pulls: it holds no socket between
/// pulls (see `WorkerHandle::set_live`). Five minutes, scaled like the longest
/// wait by this device's sync frequency.
pub fn pull_interval() -> Duration {
    let (_, longest, _) = frequency().scale();
    Duration::from_secs_f64(300.0 * longest)
}

fn frequency() -> Frequency {
    match FREQUENCY.load(Ordering::Relaxed) {
        0 => Frequency::Live,
        2 => Frequency::Saver,
        _ => Frequency::Balanced,
    }
}

/// A stream of outgoing changes with its own timing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lane {
    /// Window, tab and view records (and any page slots queued with them).
    Workspace,
    /// Page history, state and storage, and sign-in shards, with no record edit queued.
    Slots,
    /// Bookmarks, saved tab groups, passwords and extension settings.
    Collections,
    /// History batches.
    History,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LanePolicy {
    /// Publish once no edit has arrived for this long.
    pub quiet: Duration,
    /// Publish once the oldest unsent edit is this old, even mid-burst.
    pub max_wait: Duration,
    /// Publish once this many edits are queued.
    pub max_edits: usize,
}

impl LanePolicy {
    const fn ms(quiet: u64, max_wait: u64, max_edits: usize) -> Self {
        Self {
            quiet: Duration::from_millis(quiet),
            max_wait: Duration::from_millis(max_wait),
            max_edits,
        }
    }

    /// This lane under `frequency`, kept inside what the server also accepts.
    fn scaled(self, frequency: Frequency) -> Self {
        let (quiet, wait, edits) = frequency.scale();
        let quiet_ms = ((self.quiet.as_millis() as f64 * quiet) as u64).clamp(100, 60_000);
        Self::ms(
            quiet_ms,
            ((self.max_wait.as_millis() as f64 * wait) as u64)
                .clamp(250, 300_000)
                .max(quiet_ms),
            ((self.max_edits as f64 * edits) as usize).clamp(1, 1_000),
        )
    }

    fn from_wire(wire: &WireLane) -> Self {
        let quiet = wire.quiet_ms.clamp(100, 60_000);
        Self::ms(
            quiet,
            wire.max_wait_ms.clamp(250, 300_000).max(quiet),
            wire.max_edits.clamp(1, 1_000) as usize,
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BatchPolicy {
    /// The server's revision; an older one never replaces a newer one.
    pub revision: u64,
    pub workspace: LanePolicy,
    pub slots: LanePolicy,
    pub collections: LanePolicy,
    pub history: LanePolicy,
    /// Replaces `workspace` and `slots` while another machine edits the same
    /// workspace, so concurrent edits stay near-live and rebases stay small.
    pub contended: LanePolicy,
}

impl Default for BatchPolicy {
    fn default() -> Self {
        Self {
            revision: 0,
            workspace: LanePolicy::ms(1_000, 5_000, 50),
            slots: LanePolicy::ms(3_000, 15_000, 100),
            collections: LanePolicy::ms(1_000, 5_000, 50),
            history: LanePolicy::ms(10_000, 60_000, 200),
            contended: LanePolicy::ms(250, 1_000, 50),
        }
    }
}

impl BatchPolicy {
    /// Publishes as soon as anything is queued, like before batching. Tests.
    pub fn immediate() -> Self {
        let now = LanePolicy::ms(0, 0, 1);
        Self {
            revision: 0,
            workspace: now,
            slots: now,
            collections: now,
            history: now,
            contended: now,
        }
    }

    /// The server's policy over the defaults. Unknown lanes are ignored and
    /// missing ones keep their defaults.
    pub fn from_wire(frame: &WirePolicy) -> Self {
        let mut policy = Self {
            revision: frame.revision,
            ..Self::default()
        };
        for (name, lane) in &frame.lanes {
            let slot = match name.as_str() {
                "workspace" => &mut policy.workspace,
                "slots" => &mut policy.slots,
                "collections" => &mut policy.collections,
                "history" => &mut policy.history,
                "contended" => &mut policy.contended,
                _ => continue,
            };
            *slot = LanePolicy::from_wire(lane);
        }
        policy
    }
}

/// `batch_policy` as the server sends it.
#[derive(Clone, Debug, Deserialize)]
pub struct WirePolicy {
    pub revision: u64,
    #[serde(default)]
    pub lanes: BTreeMap<String, WireLane>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct WireLane {
    pub quiet_ms: u64,
    pub max_wait_ms: u64,
    pub max_edits: u64,
}

#[cfg(test)]
mod tests;
