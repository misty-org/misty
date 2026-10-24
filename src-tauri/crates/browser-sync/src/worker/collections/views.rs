//! What the renderer sees of each collection, and reads and writes it asks for.
use super::*;

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    pub(super) fn collection_view(
        &self,
        collection: &str,
        state: &Collection,
    ) -> Result<Vec<ViewRecord>> {
        if collection == BOOKMARKS {
            self.bookmarks_view(state)
        } else {
            Ok(state.view())
        }
    }

    /// Bookmarks as shown: the collection, plus any the shared workspace still
    /// holds that the collection has never seen (a device on an older version
    /// may still add them there). Deletions in the collection win.
    pub(super) fn bookmarks_view(&self, state: &Collection) -> Result<Vec<ViewRecord>> {
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
    pub(super) fn migrate_bookmarks(&self, state: &mut Collection) -> Result<()> {
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
    pub(in crate::worker) fn refresh_shared_retirement(&mut self) -> Result<()> {
        let loaded = self.store.collection(&self.root, BOOKMARKS)?.loaded;
        let frames = self.workspaces.retire_shared(loaded && self.all_upgraded());
        if self.connected_now {
            self.workspace_outbox.extend(frames);
        }
        Ok(())
    }

    pub(in crate::worker) fn records_list(
        &self,
        collection: &str,
    ) -> Result<(u64, Vec<ViewRecord>)> {
        let collection = collection_name(collection).ok_or(Error::Invalid)?;
        let state = self.store.collection(&self.root, collection)?;
        Ok((state.cursor, self.collection_view(collection, &state)?))
    }

    pub(in crate::worker) fn records_write(
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
    pub(in crate::worker) fn collections_view(&self) -> Result<BTreeMap<String, Vec<ViewRecord>>> {
        let mut out = BTreeMap::new();
        for collection in collections::PROJECTED {
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
