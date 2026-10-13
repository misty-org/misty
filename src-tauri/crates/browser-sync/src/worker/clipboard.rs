//! The clipboard lane: a small ring of sealed clips in the account's
//! `clipboard` collection. The worker only moves opaque ciphertext; the
//! desktop seals and opens clips with the vault's clipboard key.
//!
//! Each ring slot is one record whose key is the keyed HMAC of its slot
//! number, so the server sees neither slot order nor clip identity. A write
//! replaces a slot (last writer wins); the server tombstones clips older than
//! a day, and readers ignore expired clips as well.
use std::collections::BTreeMap;

use super::*;
use crate::collections::{self, wire, CLIPBOARD, CLIPBOARD_SLOTS};

/// One sealed clip in the ring, as the worker last saw it on the server.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClipboardRow {
    pub slot: u8,
    pub ciphertext: Vec<u8>,
}

/// A frame the lane wants sent.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum LaneFrame {
    Pull {
        request_id: String,
        after: u64,
    },
    Push {
        request_id: String,
        write: LaneWrite,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct LaneWrite {
    pub key: String,
    pub base_version: u64,
    pub ciphertext: Vec<u8>,
}

#[derive(Default)]
pub(super) struct ClipboardLane {
    /// Record key of each slot, by slot number.
    keys: Vec<String>,
    /// Slot -> (stored version, ciphertext).
    rows: BTreeMap<u8, (u64, Vec<u8>)>,
    cursor: u64,
    pull_due: bool,
    pulling: Option<String>,
    /// The newest unsent clip for each slot.
    pending: BTreeMap<u8, Vec<u8>>,
    pushing: Option<(String, u8, Vec<u8>)>,
}

impl ClipboardLane {
    pub(super) fn new(root: &VaultRoot, scope: &VaultScope) -> Result<Self> {
        let keys = (0..CLIPBOARD_SLOTS)
            .map(|slot| collections::record_key(root, scope, CLIPBOARD, &format!("slot-{slot}")))
            .collect::<Result<_>>()?;
        Ok(Self {
            keys,
            ..Self::default()
        })
    }

    fn slot_of(&self, key: &str) -> Option<u8> {
        self.keys
            .iter()
            .position(|k| k == key)
            .map(|slot| slot as u8)
    }

    /// A new connection reads the whole ring again.
    pub(super) fn connected(&mut self) {
        self.cursor = 0;
        self.rows.clear();
        self.pulling = None;
        if let Some((_, slot, ciphertext)) = self.pushing.take() {
            self.pending.entry(slot).or_insert(ciphertext);
        }
        self.pull_due = true;
    }

    /// Another device wrote to the ring.
    pub(super) fn hinted(&mut self) {
        self.pull_due = true;
    }

    /// Queues a sealed clip for `slot`, replacing any unsent clip there.
    pub(super) fn publish(&mut self, slot: u8, ciphertext: Vec<u8>) -> Result<()> {
        if slot >= CLIPBOARD_SLOTS
            || ciphertext.is_empty()
            || ciphertext.len() > collections::CLIPBOARD_MAX_BYTES
        {
            return Err(Error::Invalid);
        }
        self.pending.insert(slot, ciphertext);
        Ok(())
    }

    /// The next frame to send, if any: a due pull first, then one write.
    pub(super) fn next(&mut self) -> Option<LaneFrame> {
        if self.pulling.is_some() || self.pushing.is_some() {
            return None;
        }
        if self.pull_due {
            self.pull_due = false;
            let request_id = uuid::Uuid::new_v4().to_string();
            self.pulling = Some(request_id.clone());
            return Some(LaneFrame::Pull {
                request_id,
                after: self.cursor,
            });
        }
        let slot = *self.pending.keys().next()?;
        let ciphertext = self.pending.remove(&slot)?;
        let request_id = uuid::Uuid::new_v4().to_string();
        let write = LaneWrite {
            key: self.keys[slot as usize].clone(),
            base_version: self.rows.get(&slot).map_or(0, |(version, _)| *version),
            ciphertext: ciphertext.clone(),
        };
        self.pushing = Some((request_id.clone(), slot, ciphertext));
        Some(LaneFrame::Push { request_id, write })
    }

    fn store(&mut self, row: &wire::Record) {
        let Some(slot) = self.slot_of(&row.key) else {
            return;
        };
        match &row.ciphertext {
            Some(ciphertext) => {
                self.rows.insert(slot, (row.version, ciphertext.clone()));
            }
            None => {
                self.rows.remove(&slot);
            }
        }
    }

    /// Applies a listing this lane asked for. Returns `None` when the request
    /// is not the lane's.
    pub(super) fn listing(&mut self, request: Option<&str>, listing: &wire::Listing) -> Option<()> {
        if request.is_none() || self.pulling.as_deref() != request {
            return None;
        }
        self.pulling = None;
        if listing.reset {
            self.rows.clear();
        }
        for row in &listing.records {
            self.store(row);
        }
        self.cursor = listing.cursor;
        self.pull_due |= listing.more;
        Some(())
    }

    /// Applies the answer to this lane's write. A write that lost a race takes
    /// the server's version and goes again: the newest clip wins.
    pub(super) fn ack(&mut self, request: Option<&str>, answers: &[wire::Answer]) -> Option<()> {
        let (request_id, slot, ciphertext) = self.pushing.take()?;
        if request != Some(request_id.as_str()) {
            self.pushing = Some((request_id, slot, ciphertext));
            return None;
        }
        let key = self.keys[slot as usize].clone();
        match answers.iter().find(|answer| answer.key == key) {
            Some(answer) if answer.applied => {
                self.rows.insert(slot, (answer.version, ciphertext));
            }
            Some(answer) => {
                match &answer.current {
                    Some(current) => self.store(current),
                    None => {
                        self.rows.remove(&slot);
                    }
                }
                if let Some((version, _)) = self.rows.get_mut(&slot) {
                    *version = (*version).max(answer.version);
                }
                self.pending.entry(slot).or_insert(ciphertext);
            }
            None => {
                self.pending.entry(slot).or_insert(ciphertext);
            }
        }
        Some(())
    }

    /// A request of this lane failed; it is tried again on the next tick.
    pub(super) fn failed(&mut self, request: Option<&str>) -> bool {
        let Some(request) = request else {
            return false;
        };
        if self.pulling.as_deref() == Some(request) {
            self.pulling = None;
            self.pull_due = true;
            return true;
        }
        if self
            .pushing
            .as_ref()
            .is_some_and(|(id, _, _)| id == request)
        {
            let (_, slot, ciphertext) = self.pushing.take().expect("checked above");
            self.pending.entry(slot).or_insert(ciphertext);
            return true;
        }
        false
    }

    pub(super) fn rows(&self) -> Vec<ClipboardRow> {
        self.rows
            .iter()
            .map(|(slot, (_, ciphertext))| ClipboardRow {
                slot: *slot,
                ciphertext: ciphertext.clone(),
            })
            .collect()
    }
}

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    /// Sends what the clipboard lane has due.
    pub(super) async fn clipboard_tick(&mut self, socket: &mut SyncSocket) -> Result<()> {
        while let Some(frame) = self.clipboard.next() {
            match frame {
                LaneFrame::Pull { request_id, after } => {
                    socket
                        .send(&ClientFrame::RecordsPull {
                            request_id: &request_id,
                            collection: CLIPBOARD,
                            after,
                        })
                        .await?
                }
                LaneFrame::Push { request_id, write } => {
                    socket
                        .send(&ClientFrame::RecordsPush {
                            request_id: &request_id,
                            collection: CLIPBOARD,
                            writes: &[wire::Write {
                                key: write.key,
                                base_version: write.base_version,
                                ciphertext: Some(write.ciphertext),
                            }],
                        })
                        .await?
                }
            }
        }
        Ok(())
    }

    pub(super) fn publish_clipboard_rows(&self) {
        let rows = self.clipboard.rows();
        self.clipboard_rows.send_if_modified(|current| {
            if *current == rows {
                false
            } else {
                *current = rows;
                true
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lane() -> ClipboardLane {
        ClipboardLane {
            keys: (0..CLIPBOARD_SLOTS)
                .map(|slot| format!("{slot:064x}"))
                .collect(),
            ..ClipboardLane::default()
        }
    }

    fn listing(records: Vec<wire::Record>, cursor: u64, more: bool) -> wire::Listing {
        wire::Listing {
            collection: CLIPBOARD.into(),
            records,
            cursor,
            more,
            reset: false,
        }
    }

    fn row(slot: u8, version: u64, ciphertext: Option<&[u8]>) -> wire::Record {
        wire::Record {
            key: format!("{slot:064x}"),
            version,
            ciphertext: ciphertext.map(<[u8]>::to_vec),
        }
    }

    #[test]
    fn reads_the_ring_then_writes_with_the_stored_version() {
        let mut lane = lane();
        lane.connected();
        let Some(LaneFrame::Pull {
            request_id,
            after: 0,
        }) = lane.next()
        else {
            panic!("a new connection pulls first");
        };
        lane.publish(3, b"new".to_vec()).unwrap();
        assert_eq!(lane.next(), None, "one request at a time");
        lane.listing(
            Some(&request_id),
            &listing(
                vec![row(3, 4, Some(b"old")), row(7, 1, Some(b"x"))],
                9,
                false,
            ),
        )
        .unwrap();
        assert_eq!(lane.rows().len(), 2);
        let Some(LaneFrame::Push { request_id, write }) = lane.next() else {
            panic!("the queued clip goes out");
        };
        assert_eq!(
            (write.base_version, write.ciphertext.as_slice()),
            (4, &b"new"[..])
        );
        let answer = wire::Answer {
            key: write.key,
            applied: true,
            version: 5,
            current: None,
        };
        lane.ack(Some(&request_id), &[answer]).unwrap();
        assert!(lane.rows().contains(&ClipboardRow {
            slot: 3,
            ciphertext: b"new".to_vec()
        }));
        assert_eq!(lane.next(), None);
    }

    #[test]
    fn a_lost_race_retries_on_the_servers_version() {
        let mut lane = lane();
        lane.publish(0, b"mine".to_vec()).unwrap();
        let Some(LaneFrame::Push { request_id, write }) = lane.next() else {
            panic!("push");
        };
        let answer = wire::Answer {
            key: write.key,
            applied: false,
            version: 8,
            current: Some(row(0, 8, Some(b"theirs"))),
        };
        lane.ack(Some(&request_id), &[answer]).unwrap();
        let Some(LaneFrame::Push { write, .. }) = lane.next() else {
            panic!("retry");
        };
        assert_eq!(
            (write.base_version, write.ciphertext.as_slice()),
            (8, &b"mine"[..])
        );
    }

    #[test]
    fn tombstones_clear_slots_and_failures_retry() {
        let mut lane = lane();
        lane.connected();
        let Some(LaneFrame::Pull { request_id, .. }) = lane.next() else {
            panic!("pull");
        };
        assert!(lane.failed(Some(&request_id)));
        let Some(LaneFrame::Pull { request_id, .. }) = lane.next() else {
            panic!("pull again");
        };
        lane.listing(
            Some(&request_id),
            &listing(vec![row(1, 2, Some(b"a"))], 2, true),
        )
        .unwrap();
        let Some(LaneFrame::Pull {
            request_id,
            after: 2,
        }) = lane.next()
        else {
            panic!("the next page");
        };
        lane.listing(Some(&request_id), &listing(vec![row(1, 3, None)], 3, false))
            .unwrap();
        assert!(lane.rows().is_empty());
        assert!(!lane.failed(Some("someone else's")));
        assert!(lane
            .listing(Some("someone else's"), &listing(vec![], 0, false))
            .is_none());
        assert!(lane.publish(CLIPBOARD_SLOTS, b"x".to_vec()).is_err());
    }
}
