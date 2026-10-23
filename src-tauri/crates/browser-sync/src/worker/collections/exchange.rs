//! Pulling collections from the server and pushing pending writes to it.
use super::*;

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    /// Sends due pulls, then pending writes of fully pulled collections.
    pub(in crate::worker) async fn records_tick(&mut self, socket: &mut SyncSocket) -> Result<()> {
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
            if !self
                .collections
                .batch
                .due(collection, lane(collection), std::time::Instant::now())
            {
                continue;
            }
            let mut writes = Vec::new();
            let mut sent = BTreeMap::new();
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
                sent.insert(write.key.clone(), write.record);
                writes.push(wire::Write {
                    key: write.key,
                    base_version: write.base_version,
                    ciphertext,
                });
            }
            let request_id = uuid::Uuid::new_v4().to_string();
            self.collections
                .pushing
                .insert(request_id.clone(), Push { collection, sent });
            self.collections.batch.published(collection);
            if state.pending.len() > MAX_PUSH {
                // The rest already waited their turn.
                self.collections.batch.retry(collection);
            }
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

    pub(super) fn open_row(&self, collection: &str, row: &wire::Record) -> Option<Confirmed> {
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

    pub(in crate::worker) fn records_listing(
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
        if listing.reset || !listing.records.is_empty() {
            self.collections.changed_elsewhere(collection);
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

    pub(in crate::worker) fn records_ack(
        &mut self,
        request: Option<&str>,
        answers: Vec<wire::Answer>,
    ) -> Result<()> {
        let Some(Push { collection, sent }) =
            request.and_then(|r| self.collections.pushing.remove(r))
        else {
            return Ok(());
        };
        let mut state = self.store.collection(&self.root, collection)?;
        for answer in answers {
            // An answer for a write this push did not send is ignored.
            let Some(record) = sent.get(&answer.key) else {
                continue;
            };
            let current = answer
                .current
                .as_ref()
                .and_then(|row| self.open_row(collection, row));
            if !answer.applied {
                self.collections.changed_elsewhere(collection);
            }
            state.answered(&answer.key, record, answer.applied, answer.version, current);
        }
        // Writes that lost a race retry on the server's copy without
        // waiting for another batch.
        if !state.pending.is_empty() {
            self.collections.batch.retry(collection);
        }
        self.store.set_collection(&self.root, collection, &state)?;
        self.publish_sync_state()
    }

    /// A failed request is retried on the next pull or push; a push the
    /// server turned away for rate waits as long as it asked.
    pub(in crate::worker) fn records_failed(
        &mut self,
        request: Option<&str>,
        code: &str,
        retry_after: Option<Duration>,
    ) -> bool {
        let Some(request) = request else { return false };
        if let Some(collection) = self.collections.pulling.remove(request) {
            self.collections
                .due
                .insert(collection, Instant::now() + HINT_DEBOUNCE);
            return true;
        }
        let Some(Push { collection, .. }) = self.collections.pushing.remove(request) else {
            return false;
        };
        if code == "sync_rate_limited" {
            self.collections.batch.hold(
                collection,
                retry_after.unwrap_or(Duration::from_secs(5)),
                std::time::Instant::now(),
            );
        }
        true
    }
}
