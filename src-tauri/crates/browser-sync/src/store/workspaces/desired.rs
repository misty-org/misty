//! Local edits still to publish, grouped into batches by base version.
use serde::{Deserialize, Serialize};

use crate::document::{Change, Resume};

/// Local edits still to publish. They survive restarts and offline periods
/// and are rebuilt into a fresh op against whatever version the server holds
/// when the device can publish. Changes are replayed onto the latest server
/// records (a rebase), so concurrent edits to the shared workspace from other
/// devices are never overwritten by a stale full copy.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Desired {
    pub changes: Vec<Change>,
    /// Written by older versions, which synced focus. Read so their queues
    /// still load; never sent.
    pub resume: Option<Resume>,
    /// Pending slot writes keyed by `(tab node, slot)`; `None` deletes.
    pub slots: Vec<(String, i16, Option<Vec<u8>>)>,
    pub blob_refs: Vec<Vec<u8>>,
    /// One entry per user edit, in order, covering `changes`: how many
    /// changes it holds and the verified workspace version it was made against.
    /// Queues written before batches existed have none (see `batches`).
    #[serde(default)]
    pub batches: Vec<Batch>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Batch {
    pub len: usize,
    /// The verified workspace version when the edit was made. A record another
    /// machine deleted after this version is not recreated by the edit.
    pub base: u64,
}

impl Desired {
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
            && self.resume.is_none()
            && self.slots.is_empty()
            && self.blob_refs.is_empty()
    }

    pub fn push_batch(&mut self, changes: Vec<Change>, base: u64) {
        if changes.is_empty() {
            return;
        }
        self.batches.push(Batch {
            len: changes.len(),
            base,
        });
        self.changes.extend(changes);
    }

    /// The queued edits in order with their base versions. Changes queued
    /// before batches were recorded come first, as one edit of unknown base
    /// (0): stale creates in it are dropped rather than risk resurrection.
    pub fn batches(&self) -> Vec<(u64, &[Change])> {
        let tracked: usize = self.batches.iter().map(|b| b.len).sum();
        let untracked = self.changes.len().saturating_sub(tracked);
        let mut out = Vec::with_capacity(self.batches.len() + 1);
        let mut at = 0;
        if untracked > 0 {
            out.push((0, &self.changes[..untracked]));
            at = untracked;
        }
        for batch in &self.batches {
            let end = (at + batch.len).min(self.changes.len());
            if end > at {
                out.push((batch.base, &self.changes[at..end]));
            }
            at = end;
        }
        out
    }

    /// Removes the first `n` changes (what an accepted op carried), keeping
    /// the batch bookkeeping aligned with what remains.
    pub fn drain_changes(&mut self, n: usize) {
        let n = n.min(self.changes.len());
        let tracked: usize = self.batches.iter().map(|b| b.len).sum();
        let mut remove = n.saturating_sub(self.changes.len().saturating_sub(tracked));
        self.changes.drain(..n);
        while remove > 0 {
            let Some(first) = self.batches.first_mut() else {
                break;
            };
            if first.len <= remove {
                remove -= first.len;
                self.batches.remove(0);
            } else {
                first.len -= remove;
                remove = 0;
            }
        }
    }

    /// Drops the oldest edit. A rejected op is retried without it, so one
    /// bad edit costs only itself, never the edits queued behind it.
    pub fn drop_first_batch(&mut self) {
        let first = self
            .batches()
            .first()
            .map_or(0, |(_, changes)| changes.len());
        self.drain_changes(first);
    }
}
