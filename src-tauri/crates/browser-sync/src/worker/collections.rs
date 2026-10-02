//! Collections glue for the worker: pulls collections when a connection starts,
//! when the server hints one moved (debounced) and on a slow safety interval;
//! pushes pending writes one batch at a time. `records` holds the logic.
use std::collections::{BTreeMap, BTreeSet};

use super::*;
use crate::{
    collections::{self, wire, Collection, Confirmed, BOOKMARKS, COLLECTIONS},
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

/// Per-connection collections state.
#[derive(Default)]
pub(super) struct CollectionSync {
    /// When each collection should next be pulled.
    due: BTreeMap<&'static str, Instant>,
    /// Request id → collection, for pulls and pushes awaiting an answer.
    pulling: BTreeMap<String, &'static str>,
    pushing: BTreeMap<String, &'static str>,
}

fn collection_name(name: &str) -> Option<&'static str> {
    COLLECTIONS.iter().copied().find(|c| *c == name)
}

impl CollectionSync {
    pub(super) fn connected(&mut self) {
        *self = Self::default();
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
        self.pulling
            .values()
            .chain(self.pushing.values())
            .any(|c| *c == collection)
    }
}

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    /// Sends due pulls, then pending writes of fully pulled collections.
    pub(super) async fn records_tick(&mut self, socket: &mut SyncSocket) -> Result<()> {
        let now = Instant::now();
        for collection in COLLECTIONS {
            if self.collections.busy(collection) {
                continue;
            }
            let due = self
                .collections
                .due
                .get(collection)
                .is_some_and(|at| *at <= now);
            let state = self.store.collection(&self.root, collection)?;
            if due {
                self.collections.due.insert(collection, now + SAFETY_PULL);
                let request_id = uuid::Uuid::new_v4().to_string();
                self.collections
                    .pulling
                    .insert(request_id.clone(), collection);
                socket
                    .send(&ClientFrame::RecordsPull {
                        request_id: &request_id,
                        collection,
                        after: state.cursor,
                    })
                    .await?;
                continue;
            }
            if !state.loaded || state.pending.is_empty() {
                continue;
            }
            let mut writes = Vec::new();
            for write in state.outgoing().into_iter().take(MAX_PUSH) {
                let ciphertext = match &write.record {
                    Some(record) => Some(collections::seal(
                        &self.root,
                        &self.scope,
                        collection,
                        write.base_version + 1,
                        record,
                    )?),
                    None => None,
                };
                writes.push(wire::Write {
                    key: write.key,
                    base_version: write.base_version,
                    ciphertext,
                });
            }
            let request_id = uuid::Uuid::new_v4().to_string();
            self.collections
                .pushing
                .insert(request_id.clone(), collection);
            socket
                .send(&ClientFrame::RecordsPush {
                    request_id: &request_id,
                    collection,
                    writes: &writes,
                })
                .await?;
        }
        Ok(())
    }

    fn open_row(&self, collection: &str, row: &wire::Record) -> Option<Confirmed> {
        let record = match &row.ciphertext {
            // A row that fails to open is skipped, never trusted.
            Some(sealed) => Some(
                collections::open(
                    &self.root,
                    &self.scope,
                    collection,
                    &row.key,
                    row.version,
                    sealed,
                )
                .ok()?,
            ),
            None => None,
        };
        Some(Confirmed {
            version: row.version,
            record,
        })
    }

    pub(super) fn records_listing(
        &mut self,
        request: Option<&str>,
        listing: wire::Listing,
    ) -> Result<()> {
        let Some(collection) = request.and_then(|r| self.collections.pulling.remove(r)) else {
            return Ok(());
        };
        if listing.collection != collection {
            return Err(Error::Invalid);
        }
        let mut state = self.store.collection(&self.root, collection)?;
        if listing.reset {
            // The server compacted deletions this machine never saw: re-read
            // everything. Pending writes stay and retry on what arrives.
            state.confirmed.clear();
            state.loaded = false;
        }
        for row in &listing.records {
            if let Some(confirmed) = self.open_row(collection, row) {
                state.pulled(row.key.clone(), confirmed.version, confirmed.record);
            }
        }
        state.cursor = listing.cursor;
        if listing.more {
            self.collections.due.insert(collection, Instant::now());
        } else {
            let first_load = !state.loaded;
            state.loaded = true;
            if first_load && collection == BOOKMARKS {
                self.migrate_bookmarks(&mut state)?;
            }
        }
        self.store.set_collection(&self.root, collection, &state)?;
        self.refresh_shared_retirement()?;
        self.publish_sync_state()
    }

    pub(super) fn records_ack(
        &mut self,
        request: Option<&str>,
        answers: Vec<wire::Answer>,
    ) -> Result<()> {
        let Some(collection) = request.and_then(|r| self.collections.pushing.remove(r)) else {
            return Ok(());
        };
        let mut state = self.store.collection(&self.root, collection)?;
        for answer in answers {
            let current = answer
                .current
                .as_ref()
                .and_then(|row| self.open_row(collection, row));
            state.answered(&answer.key, answer.applied, answer.version, current);
        }
        self.store.set_collection(&self.root, collection, &state)?;
        self.publish_sync_state()
    }

    /// A failed request is retried on the next pull or push.
    pub(super) fn records_failed(&mut self, request: Option<&str>) -> bool {
        let Some(request) = request else { return false };
        if let Some(collection) = self.collections.pulling.remove(request) {
            self.collections
                .due
                .insert(collection, Instant::now() + HINT_DEBOUNCE);
            return true;
        }
        self.collections.pushing.remove(request).is_some()
    }

    /// Every active device runs a version that understands tab groups and
    /// collections; until then those records are never written.
    pub(super) fn all_upgraded(&self) -> bool {
        let devices = self.devices.borrow();
        let mut active = devices.iter().filter(|d| d.revoked_at.is_none()).peekable();
        active.peek().is_some() && active.all(|d| d.uses_collections)
    }

    /// Records that live in a collection (bookmarks, saved tab groups)
    /// are turned into whole-record writes there. Tab-group records wait for
    /// every device to understand them. Returns the remaining (workspace) changes.
    pub(super) fn route_record_changes(&mut self, changes: Vec<Change>) -> Result<Vec<Change>> {
        use crate::document::entities::Kind;
        let upgraded = self.all_upgraded();
        let mut by_collection: BTreeMap<&'static str, Vec<Change>> = BTreeMap::new();
        let mut rest = Vec::new();
        for change in changes {
            let kind = crate::workspace::model::change_kind(&change);
            if matches!(kind, Kind::TabGroup | Kind::SavedTabGroup) && !upgraded {
                continue;
            }
            match collection_of(kind) {
                Some(collection) => by_collection.entry(collection).or_default().push(change),
                None => rest.push(change),
            }
        }
        for (collection, changes) in by_collection {
            self.write_records(collection, changes)?;
        }
        Ok(rest)
    }

    fn write_records(&mut self, collection: &'static str, changes: Vec<Change>) -> Result<()> {
        let mut state = self.store.collection(&self.root, collection)?;
        let mut shown: BTreeMap<(crate::document::entities::Kind, String), ViewRecord> = self
            .collection_view(collection, &state)?
            .into_iter()
            .map(|r| ((r.kind, r.id.clone()), r))
            .collect();
        for change in changes {
            let (kind, id, record) = match change {
                Change::Create { kind, id, fields } => {
                    let record = ViewRecord {
                        kind,
                        id: id.clone(),
                        fields,
                    };
                    (kind, id, Some(record))
                }
                Change::Patch { kind, id, fields } => {
                    // A patch of a record that is gone is a no-op, as in workspaces.
                    let Some(mut record) = shown.get(&(kind, id.clone())).cloned() else {
                        continue;
                    };
                    record.fields.extend(fields);
                    (kind, id, Some(record))
                }
                Change::Delete { kind, id } => (kind, id, None),
            };
            if let Some(record) = &record {
                crate::document::entities::validate(kind, &record.fields)?;
                shown.insert((kind, id.clone()), record.clone());
            } else {
                shown.remove(&(kind, id.clone()));
            }
            let key = collections::record_key(&self.root, &self.scope, collection, &id)?;
            state.write(key, record);
        }
        self.store.set_collection(&self.root, collection, &state)
    }

    fn collection_view(&self, collection: &str, state: &Collection) -> Result<Vec<ViewRecord>> {
        if collection == BOOKMARKS {
            self.bookmarks_view(state)
        } else {
            Ok(state.view())
        }
    }

    /// Bookmarks as shown: the collection, plus any the shared workspace still
    /// holds that the collection has never seen (a device on an older version
    /// may still add them there). Deletions in the collection win.
    fn bookmarks_view(&self, state: &Collection) -> Result<Vec<ViewRecord>> {
        let mut out = state.view();
        let shared = self.workspaces.shared_records();
        let mut seen: BTreeSet<String> = state.confirmed.keys().cloned().collect();
        seen.extend(state.pending.keys().cloned());
        for record in shared {
            let key = collections::record_key(&self.root, &self.scope, BOOKMARKS, &record.id)?;
            if !seen.contains(&key) {
                out.push(record);
            }
        }
        Ok(out)
    }

    /// First complete pull of an empty collection: copy the shared workspace's
    /// bookmarks in. Idempotent across devices: a device that loses the race
    /// receives the same records back and its copies settle as moot.
    fn migrate_bookmarks(&self, state: &mut Collection) -> Result<()> {
        if !state.confirmed.is_empty() {
            return Ok(());
        }
        for record in self.workspaces.shared_records() {
            let key = collections::record_key(&self.root, &self.scope, BOOKMARKS, &record.id)?;
            state.pending.entry(key).or_insert(Some(record));
        }
        Ok(())
    }

    /// Stops watching the shared workspace once this machine has its bookmarks in
    /// collections and every active device does too.
    pub(super) fn refresh_shared_retirement(&mut self) -> Result<()> {
        let loaded = self.store.collection(&self.root, BOOKMARKS)?.loaded;
        let frames = self.workspaces.retire_shared(loaded && self.all_upgraded());
        if self.connected_now {
            self.workspace_outbox.extend(frames);
        }
        Ok(())
    }

    pub(super) fn records_list(&self, collection: &str) -> Result<(u64, Vec<ViewRecord>)> {
        let collection = collection_name(collection).ok_or(Error::Invalid)?;
        let state = self.store.collection(&self.root, collection)?;
        Ok((state.cursor, self.collection_view(collection, &state)?))
    }

    pub(super) fn records_write(
        &mut self,
        collection: &str,
        writes: Vec<(String, Option<ViewRecord>)>,
    ) -> Result<()> {
        let collection = collection_name(collection).ok_or(Error::Invalid)?;
        let state = self.store.collection(&self.root, collection)?;
        let kinds: BTreeMap<String, crate::document::entities::Kind> = self
            .collection_view(collection, &state)?
            .into_iter()
            .map(|r| (r.id, r.kind))
            .collect();
        let mut changes = Vec::with_capacity(writes.len());
        for (id, record) in writes {
            match record {
                Some(record)
                    if record.id == id && collection_of(record.kind) == Some(collection) =>
                {
                    changes.push(Change::Create {
                        kind: record.kind,
                        id,
                        fields: record.fields,
                    });
                }
                Some(_) => return Err(Error::Invalid),
                // Deleting what is not there is a no-op.
                None => {
                    if let Some(kind) = kinds.get(&id) {
                        changes.push(Change::Delete { kind: *kind, id });
                    }
                }
            }
        }
        self.write_records(collection, changes)
    }

    /// The published view with collections filled in. History is read
    /// on demand (`records_list`): too large to copy into every view.
    pub(super) fn collections_view(&self) -> Result<BTreeMap<String, Vec<ViewRecord>>> {
        let mut out = BTreeMap::new();
        for collection in COLLECTIONS
            .into_iter()
            .filter(|c| *c != collections::HISTORY)
        {
            let state = self.store.collection(&self.root, collection)?;
            if state.loaded || !state.pending.is_empty() {
                out.insert(
                    collection.to_owned(),
                    self.collection_view(collection, &state)?,
                );
            }
        }
        Ok(out)
    }
}
