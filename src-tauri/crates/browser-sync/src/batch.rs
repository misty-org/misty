//! When queued changes are published. Edits are stored durably the moment
//! they are made; this only decides when a queue goes to the server, so a
//! burst of edits costs one request. What a request carries is unchanged: it
//! is the difference between the queued state and the server's, so edits that
//! cancel out never leave the machine.
//!
//! The server sends the timings (`batch_policy`, already scaled by the
//! account's sync frequency); the defaults here apply until it does. Values
//! from the server are clamped: a bad policy can slow sync down, never stop it.
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    time::{Duration, Instant},
};

use serde::Deserialize;

/// How long a workspace counts as edited by another machine after its last
/// change from one arrives.
const CONTENDED_FOR: Duration = Duration::from_secs(30);
/// Longest a server may hold back a queue after rejecting it for rate.
pub const MAX_HOLD: Duration = Duration::from_secs(300);

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

#[derive(Clone, Copy)]
struct Queued {
    first: Instant,
    last: Instant,
    edits: usize,
}

/// Per-target batching state. A target is a workspace ID or a collection name.
pub struct Batcher {
    policy: BatchPolicy,
    queued: HashMap<String, Queued>,
    contended: HashMap<String, Instant>,
    held: HashMap<String, Instant>,
    retry: HashSet<String>,
    urgent: bool,
}

impl Default for Batcher {
    fn default() -> Self {
        Self::new(BatchPolicy::default())
    }
}

impl Batcher {
    pub fn new(policy: BatchPolicy) -> Self {
        Self {
            policy,
            queued: HashMap::new(),
            contended: HashMap::new(),
            held: HashMap::new(),
            retry: HashSet::new(),
            urgent: false,
        }
    }

    pub fn policy(&self) -> &BatchPolicy {
        &self.policy
    }

    /// Takes a newer policy; queued edits are judged by it from now on.
    pub fn set_policy(&mut self, policy: BatchPolicy) -> bool {
        if policy.revision < self.policy.revision || policy == self.policy {
            return false;
        }
        self.policy = policy;
        true
    }

    /// `edits` changes were queued for `target`.
    pub fn edited(&mut self, target: &str, edits: usize, now: Instant) {
        let queued = self.queued.entry(target.to_owned()).or_insert(Queued {
            first: now,
            last: now,
            edits: 0,
        });
        queued.last = now;
        queued.edits = queued.edits.saturating_add(edits);
    }

    /// Another machine changed `target`.
    pub fn contend(&mut self, target: &str, now: Instant) {
        self.contended.insert(target.to_owned(), now + CONTENDED_FOR);
    }

    pub fn contended(&self, target: &str, now: Instant) -> bool {
        self.contended.get(target).is_some_and(|until| *until > now)
    }

    /// The server asked this machine to wait before sending `target` again.
    pub fn hold(&mut self, target: &str, delay: Duration, now: Instant) {
        self.held
            .insert(target.to_owned(), now + delay.clamp(Duration::from_secs(1), MAX_HOLD));
    }

    /// The queue already waited its turn (a lost race, a rejected edit, or
    /// writes beyond one request's size): send it again as soon as possible.
    pub fn retry(&mut self, target: &str) {
        self.retry.insert(target.to_owned());
    }

    /// Everything queued is due now (quit, lock, sign-out, switching
    /// workspaces, Sync now) until `settled`.
    pub fn flush(&mut self) {
        self.urgent = true;
    }

    pub fn flushing(&self) -> bool {
        self.urgent
    }

    pub fn settled(&mut self) {
        self.urgent = false;
    }

    /// Whether `target`'s queue should be published now. A queue with no
    /// recorded edit (restored from storage at startup) counts as edited now,
    /// so a restart sends its backlog after the quiet period, not in a burst.
    pub fn due(&mut self, target: &str, lane: Lane, now: Instant) -> bool {
        match self.held.get(target) {
            Some(until) if *until > now => return false,
            Some(_) => {
                self.held.remove(target);
            }
            None => {}
        }
        if self.urgent || self.retry.contains(target) {
            return true;
        }
        let policy = self.lane_policy(target, lane, now);
        let queued = *self.queued.entry(target.to_owned()).or_insert(Queued {
            first: now,
            last: now,
            edits: 0,
        });
        queued.edits >= policy.max_edits
            || now.saturating_duration_since(queued.last) >= policy.quiet
            || now.saturating_duration_since(queued.first) >= policy.max_wait
    }

    fn lane_policy(&self, target: &str, lane: Lane, now: Instant) -> LanePolicy {
        match lane {
            Lane::Workspace | Lane::Slots if self.contended(target, now) => self.policy.contended,
            Lane::Workspace => self.policy.workspace,
            Lane::Slots => self.policy.slots,
            Lane::Collections => self.policy.collections,
            Lane::History => self.policy.history,
        }
    }

    /// A request carrying `target`'s queue was sent (or found nothing to
    /// send): edits from now on start a new batch.
    pub fn published(&mut self, target: &str) {
        self.queued.remove(target);
        self.retry.remove(target);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: &str = "workspace";

    fn at(start: Instant, ms: u64) -> Instant {
        start + Duration::from_millis(ms)
    }

    #[test]
    fn a_burst_waits_for_quiet() {
        let start = Instant::now();
        let mut b = Batcher::default();
        for ms in (0..900).step_by(100) {
            b.edited(W, 1, at(start, ms));
            assert!(!b.due(W, Lane::Workspace, at(start, ms + 50)));
        }
        assert!(!b.due(W, Lane::Workspace, at(start, 1_700)));
        assert!(b.due(W, Lane::Workspace, at(start, 1_800)));
    }

    #[test]
    fn continuous_edits_publish_at_max_wait() {
        let start = Instant::now();
        let mut b = Batcher::default();
        let mut sent = Vec::new();
        for ms in (0..12_000).step_by(500) {
            b.edited(W, 1, at(start, ms));
            let probe = at(start, ms + 250);
            if b.due(W, Lane::Workspace, probe) {
                sent.push(ms + 250);
                b.published(W);
            }
        }
        // Edits arrive every 500 ms, never 1 s apart: only max_wait (5 s) fires.
        assert_eq!(sent, vec![5_250, 10_750]);
    }

    #[test]
    fn max_edits_publishes_early() {
        let start = Instant::now();
        let mut b = Batcher::default();
        b.edited(W, 49, start);
        assert!(!b.due(W, Lane::Workspace, at(start, 10)));
        b.edited(W, 1, at(start, 20));
        assert!(b.due(W, Lane::Workspace, at(start, 30)));
    }

    #[test]
    fn another_machine_editing_switches_to_near_live() {
        let start = Instant::now();
        let mut b = Batcher::default();
        b.contend(W, start);
        b.edited(W, 1, start);
        assert!(!b.due(W, Lane::Workspace, at(start, 200)));
        assert!(b.due(W, Lane::Workspace, at(start, 300)));
        b.published(W);
        // The override lapses 30 s after the other machine's last change.
        b.edited(W, 1, at(start, 31_000));
        assert!(!b.due(W, Lane::Workspace, at(start, 31_300)));
        assert!(b.due(W, Lane::Workspace, at(start, 32_000)));
    }

    #[test]
    fn a_restored_queue_waits_one_quiet_period() {
        let start = Instant::now();
        let mut b = Batcher::default();
        assert!(!b.due(W, Lane::Workspace, start));
        assert!(b.due(W, Lane::Workspace, at(start, 1_000)));
    }

    #[test]
    fn flush_and_retry_skip_the_wait_but_a_hold_does_not() {
        let start = Instant::now();
        let mut b = Batcher::default();
        b.edited(W, 1, start);
        b.retry(W);
        assert!(b.due(W, Lane::Workspace, start));
        b.published(W);
        b.edited(W, 1, start);
        b.flush();
        assert!(b.due(W, Lane::Workspace, start));
        b.hold(W, Duration::from_secs(10), start);
        assert!(!b.due(W, Lane::Workspace, at(start, 9_000)));
        assert!(b.due(W, Lane::Workspace, at(start, 10_000)));
        b.settled();
        assert!(!b.flushing());
    }

    #[test]
    fn server_values_are_clamped_and_never_go_backwards() {
        let wire: WirePolicy = serde_json::from_value(serde_json::json!({
            "revision": 2,
            "lanes": {
                "workspace": {"quiet_ms": 0, "max_wait_ms": 10_000_000, "max_edits": 0},
                "history": {"quiet_ms": 90_000, "max_wait_ms": 1_000, "max_edits": 5},
                "unknown": {"quiet_ms": 1, "max_wait_ms": 1, "max_edits": 1}
            }
        }))
        .unwrap();
        let policy = BatchPolicy::from_wire(&wire);
        assert_eq!(policy.workspace, LanePolicy::ms(100, 300_000, 1));
        assert_eq!(policy.history, LanePolicy::ms(60_000, 60_000, 5));
        assert_eq!(policy.slots, BatchPolicy::default().slots);
        let mut b = Batcher::default();
        assert!(b.set_policy(policy.clone()));
        let older = BatchPolicy {
            revision: 1,
            ..BatchPolicy::default()
        };
        assert!(!b.set_policy(older));
        assert_eq!(b.policy(), &policy);
    }
}
