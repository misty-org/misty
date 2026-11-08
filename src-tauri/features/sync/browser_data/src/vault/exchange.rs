//! What a connected session says to the server, with no I/O: which changes to send, what to do
//! with what comes back. The rule throughout is that nothing can get stuck: a record that can't
//! be sealed, sent or opened is set aside by itself and everything else carries on.
use std::collections::HashMap;
use std::time::{Duration, Instant};

use super::keys::RecordKeys;
use crate::{
    local::{Applied, DirtyRow, LocalStore},
    Result,
};

/// What fits in one push frame. The server allows a little more, for base64.
const PUSH_BYTES: usize = 1 << 20;
const PUSH_ROWS: usize = 200;
/// The largest record the server stores.
pub const MAX_SEALED: usize = 256 << 10;
/// A push unanswered for this long means the connection is gone.
pub const PUSH_TIMEOUT: Duration = Duration::from_secs(20);
/// Storage full: try again after this long, or when someone frees space and says so.
const STORAGE_FULL_WAIT: Duration = Duration::from_secs(600);

mod outcome;
mod wire;
pub use outcome::{Notice, Outcome};
pub(crate) use wire::b64;
pub use wire::*;

/// The server-set timing for changes that wait a moment so a burst goes out as one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Lane {
    quiet: Duration,
    max_wait: Duration,
}

impl From<WireLane> for Lane {
    fn from(wire: WireLane) -> Self {
        let quiet = wire.quiet_ms.clamp(100, 60_000);
        Self {
            quiet: Duration::from_millis(quiet),
            max_wait: Duration::from_millis(wire.max_wait_ms.clamp(quiet.max(250), 300_000)),
        }
    }
}

struct InFlight {
    profile: String,
    collection: String,
    id: String,
    edited_at: u64,
}

pub struct Exchange {
    keys: RecordKeys,
    cursor: u64,
    head: u64,
    next_request: u64,
    pull_in_flight: Option<String>,
    pull_again: bool,
    push_in_flight: Option<(String, Instant, HashMap<(String, String), InFlight>)>,
    records_lane: Lane,
    history_lane: Lane,
    first_waiting: Option<Instant>,
    last_edit: Option<Instant>,
    history_first_waiting: Option<Instant>,
    hold_until: Option<Instant>,
    /// A frame the server refused sends one row at a time, to find the one it objects to.
    single: bool,
    /// How many records have been set aside in this run.
    pub set_aside: u64,
    storage_full: bool,
}

const CURSOR_META: &str = "vault.cursor";

impl Exchange {
    pub fn new(keys: RecordKeys, store: &LocalStore) -> Result<Self> {
        let cursor = store
            .meta(CURSOR_META)?
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        Ok(Self {
            keys,
            cursor,
            head: cursor,
            next_request: 1,
            pull_in_flight: None,
            pull_again: false,
            push_in_flight: None,
            records_lane: Lane {
                quiet: Duration::from_millis(500),
                max_wait: Duration::from_secs(2),
            },
            history_lane: Lane {
                quiet: Duration::from_secs(10),
                max_wait: Duration::from_secs(60),
            },
            first_waiting: None,
            last_edit: None,
            history_first_waiting: None,
            hold_until: None,
            single: false,
            set_aside: 0,
            storage_full: false,
        })
    }

    pub fn cursor(&self) -> u64 {
        self.cursor
    }

    /// Records the server has that this session hasn't read yet.
    pub fn behind(&self) -> u64 {
        self.head.saturating_sub(self.cursor)
    }

    fn request_id(&mut self, kind: &str) -> String {
        let id = format!("{kind}-{}", self.next_request);
        self.next_request += 1;
        id
    }

    /// The first thing on a new connection. Requests from a lost connection can't be answered.
    pub fn connected(&mut self) -> Vec<ClientFrame> {
        self.push_in_flight = None;
        self.pull_in_flight = None;
        self.pull_again = false;
        vec![self.pull_frame()]
    }

    fn pull_frame(&mut self) -> ClientFrame {
        let request_id = self.request_id("pull");
        self.pull_in_flight = Some(request_id.clone());
        ClientFrame::Pull {
            request_id,
            after: self.cursor,
        }
    }

    /// A local change happened: it goes out when its batch is due.
    pub fn edited(&mut self, now: Instant) {
        self.last_edit = Some(now);
        self.first_waiting.get_or_insert(now);
        self.history_first_waiting.get_or_insert(now);
    }

    fn lane_due(lane: Lane, first: Option<Instant>, last: Option<Instant>, now: Instant) -> bool {
        match first {
            None => true,
            Some(first) => {
                now.duration_since(first) >= lane.max_wait
                    || last.is_none_or(|last| now.duration_since(last) >= lane.quiet)
            }
        }
    }

    /// The next push, if something is due and nothing is in flight. One record that can't be
    /// sealed is set aside and the rest still go.
    pub fn next_push(
        &mut self,
        store: &mut LocalStore,
        now: Instant,
    ) -> Result<Option<ClientFrame>> {
        if self.push_in_flight.is_some() || self.hold_until.is_some_and(|until| now < until) {
            return Ok(None);
        }
        self.hold_until = None;
        if !Self::lane_due(self.records_lane, self.first_waiting, self.last_edit, now) {
            return Ok(None);
        }
        let with_history = Self::lane_due(
            self.history_lane,
            self.history_first_waiting,
            self.last_edit,
            now,
        );
        let limit = if self.single { 1 } else { PUSH_ROWS };
        let rows = store.dirty_for_push(limit, with_history)?;
        if rows.is_empty() {
            self.first_waiting = None;
            if with_history {
                self.history_first_waiting = None;
            }
            self.last_edit = None;
            return Ok(None);
        }
        let mut writes = Vec::with_capacity(rows.len());
        let mut sent = HashMap::with_capacity(rows.len());
        let mut bytes = 0;
        for row in rows {
            let Some(write) = self.seal_row(store, &row)? else {
                continue;
            };
            if !writes.is_empty() && bytes + write.sealed.len() > PUSH_BYTES {
                break;
            }
            bytes += write.sealed.len();
            sent.insert(
                (write.scope.clone(), write.key.clone()),
                InFlight {
                    profile: row.profile,
                    collection: row.collection,
                    id: row.id,
                    edited_at: row.edited_at,
                },
            );
            writes.push(write);
        }
        if writes.is_empty() {
            return Ok(None);
        }
        let request_id = self.request_id("push");
        self.push_in_flight = Some((request_id.clone(), now, sent));
        Ok(Some(ClientFrame::Push { request_id, writes }))
    }

    fn seal_row(&mut self, store: &mut LocalStore, row: &DirtyRow) -> Result<Option<WireWrite>> {
        let sealed = self.keys.seal(
            &row.profile,
            &row.collection,
            &row.id,
            row.version + 1,
            row.edited_at,
            row.plaintext.as_deref().map(Vec::as_slice),
        );
        let sealed = match sealed {
            Ok(sealed) if sealed.len() <= MAX_SEALED => sealed,
            _ => {
                store.set_aside(&row.profile, &row.collection, &row.id)?;
                self.set_aside += 1;
                return Ok(None);
            }
        };
        Ok(Some(WireWrite {
            scope: self.keys.scope(&row.profile, &row.collection)?,
            key: self.keys.key(&row.profile, &row.collection, &row.id)?,
            base_version: row.version,
            deleted: row.plaintext.is_none(),
            // The shared clipboard's clips live a day.
            expires_in: (row.collection == crate::collections::CLIPBOARD).then_some(86_400),
            sealed,
        }))
    }

    /// Whether the connection has waited too long for an answer.
    pub fn push_timed_out(&self, now: Instant) -> bool {
        self.push_in_flight
            .as_ref()
            .is_some_and(|(_, sent, _)| now.duration_since(*sent) >= PUSH_TIMEOUT)
    }

    /// Handles one frame. A record in it that can't be opened (corrupt, from a newer version, or
    /// tampered with) is skipped: the cursor moves on, and that record alone is lost to this
    /// session until its next change.
    pub fn on_frame(&mut self, store: &mut LocalStore, frame: ServerFrame) -> Result<Outcome> {
        let mut outcome = Outcome::default();
        match frame {
            ServerFrame::Records { request_id, page } => {
                if self.pull_in_flight.as_deref() == Some(request_id.as_str()) {
                    self.pull_in_flight = None;
                    self.on_page(store, page, &mut outcome)?;
                }
            }
            ServerFrame::Pushed {
                request_id,
                results,
            } => self.on_pushed(store, &request_id, results, &mut outcome)?,
            ServerFrame::Changed => {
                if self.pull_in_flight.is_some() {
                    self.pull_again = true;
                } else {
                    outcome.send.push(self.pull_frame());
                }
            }
            ServerFrame::SessionsChanged => outcome.sessions_changed = true,
            ServerFrame::VaultKeyChanged => outcome.vault_key_changed = true,
            ServerFrame::VaultGone => {
                outcome.notice = Some(Notice::VaultGone);
                outcome.stop = true;
            }
            ServerFrame::BatchPolicy { policy } => {
                if let Some(lane) = policy.lanes.get("records") {
                    self.records_lane = (*lane).into();
                }
                if let Some(lane) = policy.lanes.get("history") {
                    self.history_lane = (*lane).into();
                }
            }
            ServerFrame::Error {
                request_id,
                code,
                retry_after_ms,
            } => self.on_error(store, &request_id, &code, retry_after_ms, &mut outcome)?,
            ServerFrame::Unknown => {}
        }
        Ok(outcome)
    }

    fn on_page(
        &mut self,
        store: &mut LocalStore,
        page: WirePage,
        outcome: &mut Outcome,
    ) -> Result<()> {
        if page.reset {
            // A full listing follows from nothing: anything local the server no longer lists,
            // and which has no change of its own to send, was deleted elsewhere long ago.
            store.begin_full_listing()?;
        }
        for record in &page.records {
            let Ok(opened) =
                self.keys
                    .open(&record.scope, &record.key, record.version, &record.sealed)
            else {
                continue;
            };
            let applied = store.apply_remote(
                &opened.profile,
                &opened.collection,
                &opened.id,
                record.version,
                opened.edited_at,
                opened.body.as_deref(),
            )?;
            if applied == Applied::Replaced {
                let change = (opened.profile, opened.collection);
                if !outcome.changed.contains(&change) {
                    outcome.changed.push(change);
                }
            }
        }
        self.head = self.head.max(page.head);
        if page.cursor >= self.cursor || page.reset {
            self.cursor = page.cursor;
            store.set_meta(CURSOR_META, &self.cursor.to_string())?;
        }
        if page.reset && !page.more {
            store.finish_full_listing()?;
        }
        if page.more || self.pull_again {
            self.pull_again = false;
            outcome.send.push(self.pull_frame());
        }
        Ok(())
    }

    fn on_pushed(
        &mut self,
        store: &mut LocalStore,
        request_id: &str,
        results: Vec<WireResult>,
        outcome: &mut Outcome,
    ) -> Result<()> {
        let Some((sent_id, _, mut sent)) = self.push_in_flight.take() else {
            return Ok(());
        };
        if sent_id != request_id {
            self.push_in_flight = Some((sent_id, Instant::now(), sent));
            return Ok(());
        }
        self.single = false;
        if self.storage_full {
            self.storage_full = false;
        }
        for result in results {
            let Some(row) = sent.remove(&(result.scope.clone(), result.key.clone())) else {
                continue;
            };
            if result.applied {
                store.accepted(
                    &row.profile,
                    &row.collection,
                    &row.id,
                    row.edited_at,
                    result.version,
                )?;
                continue;
            }
            // Someone else wrote it first. The newer edit wins: either the server's copy replaces
            // this one, or this one goes out again on the server's version.
            let opened = result.current.as_ref().and_then(|current| {
                self.keys
                    .open(
                        &current.scope,
                        &current.key,
                        current.version,
                        &current.sealed,
                    )
                    .ok()
            });
            match opened {
                Some(opened) => {
                    let applied = store.apply_remote(
                        &row.profile,
                        &row.collection,
                        &row.id,
                        result.version,
                        opened.edited_at,
                        opened.body.as_deref(),
                    )?;
                    if applied == Applied::Replaced {
                        let change = (row.profile, row.collection);
                        if !outcome.changed.contains(&change) {
                            outcome.changed.push(change);
                        }
                    }
                }
                // The server's copy can't be read, so nobody can use it: this edit replaces it.
                None => store.rebase(&row.profile, &row.collection, &row.id, result.version)?,
            }
        }
        // More may be waiting already.
        self.first_waiting = None;
        self.last_edit = None;
        Ok(())
    }

    fn on_error(
        &mut self,
        store: &mut LocalStore,
        request_id: &str,
        code: &str,
        retry_after_ms: Option<u64>,
        outcome: &mut Outcome,
    ) -> Result<()> {
        let now = Instant::now();
        if self.pull_in_flight.as_deref() == Some(request_id) {
            self.pull_in_flight = None;
        }
        let pushed = self
            .push_in_flight
            .as_ref()
            .is_some_and(|(id, _, _)| id == request_id);
        let sent = pushed
            .then(|| self.push_in_flight.take().map(|(_, _, sent)| sent))
            .flatten();
        match code {
            "sync_session_forbidden" => {
                outcome.notice = Some(Notice::SessionRemoved);
                outcome.stop = true;
            }
            "storage_limit_reached" => {
                self.storage_full = true;
                outcome.notice = Some(Notice::StorageFull);
                self.hold_until = Some(now + STORAGE_FULL_WAIT);
            }
            "sync_rate_limited" => {
                let wait = retry_after_ms.unwrap_or(1_000).clamp(100, 60_000);
                self.hold_until = Some(now + Duration::from_millis(wait));
            }
            "invalid_sync_request" => {
                // The server objects to something in that frame. Send one at a time to find it,
                // and set aside only that one.
                if let Some(sent) = sent {
                    if sent.len() == 1 {
                        for row in sent.values() {
                            store.set_aside(&row.profile, &row.collection, &row.id)?;
                            self.set_aside += 1;
                        }
                        self.single = false;
                    } else {
                        self.single = true;
                    }
                }
            }
            // Anything else passes: wait a moment and try again.
            _ => self.hold_until = Some(now + Duration::from_secs(5)),
        }
        Ok(())
    }

    /// Whether every local change has been accepted and this session has read everything.
    pub fn settled(&self, store: &LocalStore) -> Result<bool> {
        Ok(self.push_in_flight.is_none()
            && self.pull_in_flight.is_none()
            && self.cursor >= self.head
            && store.waiting()?.0 == 0)
    }

    pub fn storage_full(&self) -> bool {
        self.storage_full
    }
}

#[cfg(test)]
mod tests;
