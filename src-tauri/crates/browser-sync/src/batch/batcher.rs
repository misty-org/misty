//! Per-target batching state: when each queue is due to publish.
use super::*;

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
        self.contended
            .insert(target.to_owned(), now + CONTENDED_FOR);
    }

    pub fn contended(&self, target: &str, now: Instant) -> bool {
        self.contended.get(target).is_some_and(|until| *until > now)
    }

    /// The server asked this machine to wait before sending `target` again.
    pub fn hold(&mut self, target: &str, delay: Duration, now: Instant) {
        self.held.insert(
            target.to_owned(),
            now + delay.clamp(Duration::from_secs(1), MAX_HOLD),
        );
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
        let frequency = frequency();
        match lane {
            // Another machine is editing the same workspace: near-live, never scaled.
            Lane::Workspace | Lane::Slots if self.contended(target, now) => self.policy.contended,
            Lane::Workspace => self.policy.workspace.scaled(frequency),
            Lane::Slots => self.policy.slots.scaled(frequency),
            Lane::Collections => self.policy.collections.scaled(frequency),
            Lane::History => self.policy.history.scaled(frequency),
        }
    }

    /// A request carrying `target`'s queue was sent (or found nothing to
    /// send): edits from now on start a new batch.
    pub fn published(&mut self, target: &str) {
        self.queued.remove(target);
        self.retry.remove(target);
    }
}
