//! Routing local changes into collections, and the gates that hold back fields
//! older devices would reject.
use super::*;

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    /// No push awaits the server and no loaded collection has pending writes.
    pub(in crate::worker) fn collections_flushed(&self) -> Result<bool> {
        for collection in COLLECTIONS {
            if self.collections.pushing(collection) {
                return Ok(false);
            }
            let state = self.store.collection(&self.root, collection)?;
            if state.loaded && !state.pending.is_empty() {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// Every active device runs a version that understands tab groups and
    /// collections; until then those records are never written.
    pub(in crate::worker) fn all_upgraded(&self) -> bool {
        let devices = self.devices.borrow();
        let mut active = devices.iter().filter(|d| d.revoked_at.is_none()).peekable();
        active.peek().is_some() && active.all(|d| d.uses_collections)
    }

    /// Every active device understands nested bookmark folders (control
    /// version 2); until then their tree fields are never written.
    pub(in crate::worker) fn nested_bookmarks(&self) -> bool {
        let devices = self.devices.borrow();
        let mut active = devices.iter().filter(|d| d.revoked_at.is_none()).peekable();
        active.peek().is_some() && active.all(|d| d.uses_collections && d.control_version >= 2)
    }

    /// Every active device understands pinned tabs (control version 3); until
    /// then the pinned fields of tab records are never written.
    pub(in crate::worker) fn pinned_tabs(&self) -> bool {
        let devices = self.devices.borrow();
        let mut active = devices.iter().filter(|d| d.revoked_at.is_none()).peekable();
        active.peek().is_some() && active.all(|d| d.uses_collections && d.control_version >= 3)
    }

    /// Strips pinned fields from tab edits while some device would reject them.
    /// An edit left with no fields is dropped.
    pub(in crate::worker) fn gate_pinned_tabs(&self, changes: Vec<Change>) -> Vec<Change> {
        use crate::document::entities::{Kind, PINNED_TAB_FIELDS};
        if self.pinned_tabs() {
            return changes;
        }
        changes
            .into_iter()
            .filter_map(|change| match change {
                Change::Create {
                    kind: Kind::Tab,
                    id,
                    mut fields,
                } => {
                    for field in PINNED_TAB_FIELDS {
                        fields.remove(field);
                    }
                    Some(Change::Create {
                        kind: Kind::Tab,
                        id,
                        fields,
                    })
                }
                Change::Patch {
                    kind: Kind::Tab,
                    id,
                    mut fields,
                } => {
                    for field in PINNED_TAB_FIELDS {
                        fields.remove(field);
                    }
                    (!fields.is_empty()).then_some(Change::Patch {
                        kind: Kind::Tab,
                        id,
                        fields,
                    })
                }
                other => Some(other),
            })
            .collect()
    }

    /// Records that live in a collection (bookmarks, saved tab groups)
    /// are turned into whole-record writes there. Tab-group records wait for
    /// every device to understand them. Returns the remaining (workspace) changes.
    pub(in crate::worker) fn route_record_changes(
        &mut self,
        changes: Vec<Change>,
    ) -> Result<Vec<Change>> {
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

    pub(super) fn write_records(
        &mut self,
        collection: &'static str,
        changes: Vec<Change>,
    ) -> Result<()> {
        use crate::document::entities::{Kind, NESTED_BOOKMARK_FIELDS};
        let nested = collection != BOOKMARKS || self.nested_bookmarks();
        let mut state = self.store.collection(&self.root, collection)?;
        let mut shown: BTreeMap<(crate::document::entities::Kind, String), ViewRecord> = self
            .collection_view(collection, &state)?
            .into_iter()
            .map(|r| ((r.kind, r.id.clone()), r))
            .collect();
        let mut edits = 0;
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
            let mut record = record;
            if let Some(record) = &mut record {
                if !nested {
                    for field in NESTED_BOOKMARK_FIELDS {
                        record.fields.remove(field);
                    }
                }
                crate::document::entities::validate(kind, &record.fields)?;
                if kind == Kind::Folder {
                    folder_placement(&shown, &id, record)?;
                }
                shown.insert((kind, id.clone()), record.clone());
            } else {
                shown.remove(&(kind, id.clone()));
            }
            let key = collections::record_key(&self.root, &self.scope, collection, &id)?;
            // A record the server never had needs no delete. While a push is
            // in flight its create may still land, so the delete stays.
            let settled = state.loaded && !self.collections.pushing(collection);
            if !state.queue(key, record, settled) {
                crate::workspace::stats::add(&crate::workspace::stats::EDITS_COALESCED, 1);
            }
            edits += 1;
        }
        self.store.set_collection(&self.root, collection, &state)?;
        if edits > 0 {
            self.collections
                .batch
                .edited(collection, edits, std::time::Instant::now());
        }
        Ok(())
    }
}
