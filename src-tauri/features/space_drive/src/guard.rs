//! A brake on deleting a lot at once from outside Misty, after rclone's `--max-delete` and its
//! bisync check that stops when one side seems to have lost too much.
//!
//! Every delete in a drive is already a trash move that can be undone, but a slip (`rm -rf` in the
//! wrong folder, Select All and Delete, a script) could still empty a Space one file at a time,
//! and each would have to be put back. So deletes that reach Misty through the OS (Finder, the
//! terminal, Explorer, any app) are counted per Space in bursts: a burst ends after a quiet
//! minute. When one burst would take more than half of the Space's files (at least
//! [`SMALLEST_LIMIT`], so a small Space can still be cleared), or more than [`LARGEST_LIMIT`] files
//! however big the Space is, Misty stops it: that delete and every other one until the burst
//! ends is refused, so the OS puts the items back, and the person is told once, with Undo for
//! what the burst already deleted. A folder counts as the files in it.
//!
//! Deletes the person makes in Misty's own Files (which asks first), an agent's (held in Agent
//! trash) and a save that replaces a file aren't counted. The bursts are kept in memory only:
//! Undo is for the moment, and the Space's trash keeps everything either way.
use std::{collections::HashMap, sync::Mutex};

use crate::{lock, model::now_ms, ItemId, Kind, SpaceId};

/// A burst ends after this long with no delete from the OS.
pub const QUIET_MS: i64 = 60_000;
/// A burst may always delete this many files, however small the Space.
pub const SMALLEST_LIMIT: u64 = 20;
/// A burst never deletes more files than this, however big the Space.
pub const LARGEST_LIMIT: u64 = 1_000;
/// How many finished bursts are kept for Undo.
const KEPT: usize = 8;

/// One run of deletes from the OS in one Space.
#[derive(Clone, Debug)]
pub struct Burst {
    /// Names it for Undo.
    pub id: String,
    pub space: SpaceId,
    last_ms: i64,
    /// The most files it may take: half the Space's files when it began, within the limits.
    limit: u64,
    /// Files it took so far.
    files: u64,
    /// What it trashed, in order.
    pub items: Vec<ItemId>,
    /// It reached its limit: everything else waits until it ends.
    pub held: bool,
}

/// What [`Guard::check`] decided.
pub enum Verdict {
    /// The delete may go; record it with [`Guard::record`].
    Go,
    /// Refused, and the person has been told already.
    Held,
    /// Refused, and this is the delete that stopped the burst: tell the person, with how many
    /// files it took and its id for Undo.
    Stopped { files: u64, burst: String },
}

#[derive(Default)]
pub struct Guard {
    open: Mutex<HashMap<SpaceId, Burst>>,
    /// Bursts that ended, newest last, for Undo.
    ended: Mutex<Vec<Burst>>,
}

impl Guard {
    /// Whether a delete of `files` files may go in `space`, which holds `space_files` files.
    pub fn check(&self, space: &SpaceId, files: u64, space_files: u64) -> Verdict {
        let now = now_ms();
        let mut open = lock(&self.open);
        if let Some(burst) = open.get(space) {
            if now - burst.last_ms > QUIET_MS {
                let ended = open.remove(space).expect("checked above");
                self.keep(ended);
            }
        }
        let burst = open.entry(space.clone()).or_insert_with(|| Burst {
            id: uuid::Uuid::new_v4().to_string(),
            space: space.clone(),
            last_ms: now,
            limit: (space_files / 2).clamp(SMALLEST_LIMIT, LARGEST_LIMIT),
            files: 0,
            items: Vec::new(),
            held: false,
        });
        burst.last_ms = now;
        if burst.held {
            return Verdict::Held;
        }
        if burst.files + files.max(1) > burst.limit {
            burst.held = true;
            return Verdict::Stopped {
                files: burst.files,
                burst: burst.id.clone(),
            };
        }
        Verdict::Go
    }

    /// A delete that went: its files count toward the burst, and Undo puts it back.
    pub fn record(&self, space: &SpaceId, id: &ItemId, files: u64) {
        if let Some(burst) = lock(&self.open).get_mut(space) {
            burst.files += files.max(1);
            burst.items.push(id.clone());
        }
    }

    /// The items a burst trashed, newest first (so a folder comes back before what was in it),
    /// and forgets it: Undo runs once.
    pub fn take(&self, space: &SpaceId, burst: &str) -> Vec<ItemId> {
        let mut open = lock(&self.open);
        if open.get(space).is_some_and(|open| open.id == burst) {
            let taken = open.remove(space).expect("checked above");
            return taken.items.into_iter().rev().collect();
        }
        drop(open);
        let mut ended = lock(&self.ended);
        match ended.iter().position(|kept| kept.space == *space && kept.id == burst) {
            Some(index) => ended.remove(index).items.into_iter().rev().collect(),
            None => Vec::new(),
        }
    }

    fn keep(&self, burst: Burst) {
        if burst.items.is_empty() {
            return;
        }
        let mut ended = lock(&self.ended);
        ended.push(burst);
        let extra = ended.len().saturating_sub(KEPT);
        ended.drain(..extra);
    }
}

/// How many files a delete takes: the item's own, or a folder's.
pub fn files_in(nodes: &[crate::store::NodeRow]) -> u64 {
    nodes.iter().filter(|node| node.kind == Kind::File).count() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn space() -> SpaceId {
        SpaceId("space".into())
    }

    #[test]
    fn a_burst_stops_past_half_the_space() {
        let guard = Guard::default();
        for _ in 0..50 {
            assert!(matches!(guard.check(&space(), 1, 100), Verdict::Go));
            guard.record(&space(), &ItemId::new(), 1);
        }
        assert!(matches!(guard.check(&space(), 1, 100), Verdict::Stopped { files: 50, .. }));
        assert!(matches!(guard.check(&space(), 1, 100), Verdict::Held));
    }

    #[test]
    fn a_small_space_can_be_cleared() {
        let guard = Guard::default();
        for _ in 0..10 {
            assert!(matches!(guard.check(&space(), 1, 10), Verdict::Go));
            guard.record(&space(), &ItemId::new(), 1);
        }
    }

    #[test]
    fn a_big_folder_counts_as_its_files() {
        let guard = Guard::default();
        assert!(matches!(guard.check(&space(), 80, 100), Verdict::Stopped { files: 0, .. }));
    }

    #[test]
    fn undo_gives_the_newest_first_once() {
        let guard = Guard::default();
        let (first, second) = (ItemId::new(), ItemId::new());
        let Verdict::Go = guard.check(&space(), 1, 100) else { panic!() };
        guard.record(&space(), &first, 1);
        let Verdict::Go = guard.check(&space(), 1, 100) else { panic!() };
        guard.record(&space(), &second, 1);
        let id = lock(&guard.open).get(&space()).unwrap().id.clone();
        assert_eq!(guard.take(&space(), &id), vec![second, first]);
        assert!(guard.take(&space(), &id).is_empty());
    }
}
