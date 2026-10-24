//! Collections glue for the worker: pulls collections when a connection starts,
//! when the server hints one moved (debounced) and on a slow safety interval;
//! pushes pending writes one batch at a time, once that collection's batch is
//! due (`crate::batch`). `records` holds the logic.
use std::collections::{BTreeMap, BTreeSet};

use super::*;
use crate::{
    batch::{BatchPolicy, Batcher, Lane},
    collections::{self, wire, Collection, Confirmed, BOOKMARKS, COLLECTIONS, HISTORY},
    document::{Change, ViewRecord},
    workspace::model::collection_of,
};

/// A hinted change is pulled after this quiet period, so a burst of edits on
/// another device costs one pull.
const HINT_DEBOUNCE: Duration = Duration::from_secs(2);
/// Pull anyway this often. Hints commit with their writes and a lost server
/// listener arrives as a reset, which re-pulls everything, so this is defense
/// in depth rather than the delivery path.
const SAFETY_PULL: Duration = Duration::from_secs(3600);
const MAX_PUSH: usize = 200;

mod exchange;
mod views;
mod writes;

/// Per-connection collections state.
#[derive(Default)]
pub(super) struct CollectionSync {
    /// When each collection should next be pulled.
    due: BTreeMap<&'static str, Instant>,
    /// Request id → collection, for pulls and pushes awaiting an answer.
    pulling: BTreeMap<String, &'static str>,
    pushing: BTreeMap<String, Push>,
    /// When each collection's pending writes are due; kept across connections.
    batch: Batcher,
    /// How many times a pull or a lost write brought another device's change
    /// into each natively applied collection; kept across connections.
    revisions: BTreeMap<&'static str, u64>,
}

/// A push awaiting its answer: the records it sent, by keyed id, so an edit
/// made meanwhile is not mistaken for one the server accepted.
struct Push {
    collection: &'static str,
    sent: BTreeMap<String, Option<ViewRecord>>,
}

fn collection_name(name: &str) -> Option<&'static str> {
    COLLECTIONS.iter().copied().find(|c| *c == name)
}

impl CollectionSync {
    pub(super) fn connected(&mut self) {
        let batch = std::mem::take(&mut self.batch);
        let revisions = std::mem::take(&mut self.revisions);
        *self = Self {
            batch,
            revisions,
            ..Self::default()
        };
        let now = Instant::now();
        for collection in COLLECTIONS {
            self.due.insert(collection, now);
        }
    }

    /// A content-free hint from the server that a collection moved.
    pub(super) fn hinted(&mut self, collection: &str) {
        if let Some(collection) = collection_name(collection) {
            let at = Instant::now() + HINT_DEBOUNCE;
            let due = self.due.entry(collection).or_insert(at);
            *due = (*due).min(at);
        }
    }

    /// The server lost hints (listener reconnect or slow consumer): pull all.
    pub(super) fn reset(&mut self) {
        for collection in COLLECTIONS {
            self.hinted(collection);
        }
    }

    fn busy(&self, collection: &str) -> bool {
        self.pulling.values().any(|c| *c == collection) || self.pushing(collection)
    }

    fn pushing(&self, collection: &str) -> bool {
        self.pushing.values().any(|p| p.collection == collection)
    }

    pub(super) fn set_batch_policy(&mut self, policy: BatchPolicy) {
        self.batch.set_policy(policy);
    }

    pub(super) fn flush(&mut self) {
        self.batch.flush();
    }

    pub(super) fn flush_settled(&mut self) {
        self.batch.settled();
    }

    /// Another device's change arrived in `collection`.
    fn changed_elsewhere(&mut self, collection: &'static str) {
        if collections::NATIVE_APPLIED.contains(&collection) {
            *self.revisions.entry(collection).or_default() += 1;
        }
    }

    pub(super) fn revisions(&self) -> BTreeMap<String, u64> {
        self.revisions
            .iter()
            .map(|(collection, revision)| ((*collection).to_owned(), *revision))
            .collect()
    }
}

fn lane(collection: &str) -> Lane {
    if collection == HISTORY {
        Lane::History
    } else {
        Lane::Collections
    }
}

/// A folder may not sit inside itself or below `MAX_FOLDER_DEPTH`. Parents
/// that are not here (yet) end the walk: they arrive from another device or
/// the folder shows in Other bookmarks.
fn folder_placement(
    shown: &BTreeMap<(crate::document::entities::Kind, String), ViewRecord>,
    id: &str,
    record: &ViewRecord,
) -> Result<()> {
    use crate::document::entities::{Kind, MAX_FOLDER_DEPTH};
    let parent = |record: &ViewRecord| {
        record
            .fields
            .get("parent_id")
            .and_then(|value| value.as_str())
            .map(str::to_owned)
    };
    let mut next = parent(record);
    let mut depth = 0;
    while let Some(current) = next {
        depth += 1;
        if current == id || depth > MAX_FOLDER_DEPTH {
            return Err(Error::Invalid);
        }
        next = shown
            .get(&(Kind::Folder, current))
            .and_then(|folder| parent(folder));
    }
    Ok(())
}

#[cfg(test)]
mod folder_placement_tests;
