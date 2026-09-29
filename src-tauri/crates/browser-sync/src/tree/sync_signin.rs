//! Sign-in data operations on `TreeSync`: only the session holding a device's
//! lock (confirmed by the server on this connection) may queue writes, and
//! writes queued under a lock never outlive it.
use std::collections::BTreeMap;

use super::*;
use crate::store::DeviceSignin;

pub struct SigninStatus {
    /// This session holds the device's lock, confirmed on this connection.
    pub writer: bool,
    /// The device's verified tree state arrived on this connection, so
    /// `server` is current.
    pub current: bool,
    /// Verified content hashes of the device's sign-in slots.
    pub server: BTreeMap<i16, [u8; 32]>,
    /// Sign-in writes from this machine the server has not accepted yet.
    pub pending: bool,
    pub binding: Option<DeviceSignin>,
}

impl TreeSync {
    pub fn signin_status(
        &self,
        store: &Store,
        root: &VaultRoot,
        tree: &str,
    ) -> Result<SigninStatus> {
        let is_signin = |node: &str, kind: i16| node == tree && is_signin_slot(kind);
        let queued = store
            .tree_desired(root, tree)?
            .is_some_and(|d| d.slots.iter().any(|(node, kind, _)| is_signin(node, *kind)));
        let inflight = self.inflight.get(tree).is_some_and(|(_, op, _, _)| {
            op.slots.iter().any(|s| is_signin(&s.tab_node_id, s.slot))
        });
        Ok(SigninStatus {
            writer: self.roster_confirmed && self.driving() == Some(tree) && self.writable(),
            current: self.roster_confirmed && self.current.contains(tree),
            server: self
                .states
                .get(tree)
                .map(TreeState::signin_hashes)
                .unwrap_or_default(),
            pending: queued || inflight,
            binding: store.device_signin(root, tree)?,
        })
    }

    /// Queues shard writes for the device this session holds the lock for,
    /// and records `written` (the digests of every current shard) in the same
    /// step, so an acknowledgment can never interleave with the bookkeeping.
    /// The server re-checks the lock when the op arrives.
    pub fn write_signin(
        &mut self,
        store: &mut Store,
        root: &VaultRoot,
        tree: &str,
        writes: Vec<(i16, Option<Vec<u8>>)>,
        written: BTreeMap<i16, String>,
    ) -> Result<()> {
        if !self.roster_confirmed || self.driving() != Some(tree) || !self.writable() {
            return Err(Error::InactiveDevice);
        }
        if writes.is_empty() || writes.iter().any(|(kind, _)| !is_signin_slot(*kind)) {
            return Err(Error::Invalid);
        }
        let mut binding = store.device_signin(root, tree)?.ok_or(Error::Recovery)?;
        binding.written = written;
        binding.validate()?;
        let node = tree.to_owned();
        self.queue(store, root, tree, |desired| {
            desired.slots.extend(
                writes
                    .into_iter()
                    .map(|(kind, plain)| (node.clone(), kind, plain)),
            )
        })?;
        store.set_device_signin(root, tree, &binding)
    }

    /// Reads one sign-in shard of a device whose verified state is current.
    /// Replies with an error (and sends nothing) when it cannot be read now.
    pub fn read_signin(
        &mut self,
        tree: &str,
        kind: i16,
        reply: Reply<Option<Vec<u8>>>,
    ) -> Option<Outgoing> {
        if !is_signin_slot(kind) || !self.roster_confirmed || !self.current.contains(tree) {
            let _ = reply.send(Err(Error::Sequence));
            return None;
        }
        let request_id = Uuid::new_v4().to_string();
        self.slots.insert(
            request_id.clone(),
            (tree.to_owned(), tree.to_owned(), kind, reply),
        );
        Some(Outgoing::SlotGet {
            request_id,
            tree_id: tree.to_owned(),
            tab_node_id: tree.to_owned(),
            slot: kind,
        })
    }

    /// Discards sign-in writes queued under a lock this session no longer
    /// holds. Workspace edits stay for the choose screen; sign-in data from a
    /// lost tenure must never overwrite what the next writer publishes.
    pub(super) fn drop_signin_writes(
        &mut self,
        store: &mut Store,
        root: &VaultRoot,
        tree: &str,
    ) -> Result<()> {
        let Some(mut desired) = store.tree_desired(root, tree)? else {
            return Ok(());
        };
        let before = desired.slots.len();
        desired
            .slots
            .retain(|(node, kind, _)| !(node == tree && is_signin_slot(*kind)));
        if desired.slots.len() == before {
            return Ok(());
        }
        if desired.is_empty() {
            store.clear_tree_desired(tree)
        } else {
            store.set_tree_desired(root, tree, &desired)
        }
    }
}

#[cfg(test)]
#[path = "sync_signin_tests.rs"]
mod tests;
