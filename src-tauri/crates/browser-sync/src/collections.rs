//! Collections: rarely changed, vault-wide records (bookmarks, saved tab
//! groups, history), pulled rather than pushed and kept out of the live
//! workspace protocol.
//!
//! Each record is sealed on its own with associated data binding it to its
//! collection, keyed id and version, so the server can neither move one record
//! onto another nor roll it back unnoticed. The server sees a collection name,
//! the keyed id (an HMAC of the record id), a version and ciphertext.
//!
//! Writes are a compare-and-swap on the record's version. A write that loses
//! is retried on the server's copy (last writer wins), except that an edit
//! never recreates a record another device deleted.
use std::collections::BTreeMap;

use aes_gcm::{
    aead::{Aead, AeadCore, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};

use crate::{
    crypto::{VaultRoot, VaultScope},
    document::ViewRecord,
    Error, Result,
};

pub const BOOKMARKS: &str = "bookmarks";
pub const TAB_GROUPS: &str = "tab_groups";
/// Browsing history, in hourly batches written by the device that browsed.
pub const HISTORY: &str = "history";
pub const COLLECTIONS: [&str; 3] = [BOOKMARKS, TAB_GROUPS, HISTORY];

fn known(collection: &str) -> Result<()> {
    if COLLECTIONS.contains(&collection) {
        Ok(())
    } else {
        Err(Error::Invalid)
    }
}

/// The opaque id the server stores for a record: hex HMAC of its real id.
pub fn record_key(root: &VaultRoot, scope: &VaultScope, collection: &str, id: &str) -> Result<String> {
    use hkdf::hmac::{Hmac, Mac};
    known(collection)?;
    let key = root.derive("misty.sync.record-id.v1", &(&scope.vault_id, collection))?;
    let mut mac =
        <Hmac<sha2::Sha256> as Mac>::new_from_slice(key.as_ref()).map_err(|_| Error::Invalid)?;
    mac.update(id.as_bytes());
    Ok(mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

fn cipher(root: &VaultRoot, scope: &VaultScope, collection: &str) -> Result<Aes256Gcm> {
    let key = root.derive("misty.sync.record-key.v1", &(&scope.vault_id, collection))?;
    Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| Error::Invalid)
}

fn aad(scope: &VaultScope, collection: &str, key: &str, version: u64) -> Result<Vec<u8>> {
    if version == 0 {
        return Err(Error::Invalid);
    }
    scope.aad("misty.sync.record.v1", &(collection, key, version))
}

/// `nonce || ciphertext` for `record` stored as `version`.
pub fn seal(
    root: &VaultRoot,
    scope: &VaultScope,
    collection: &str,
    version: u64,
    record: &ViewRecord,
) -> Result<Vec<u8>> {
    let key = record_key(root, scope, collection, &record.id)?;
    let plain = zeroize::Zeroizing::new(serde_json::to_vec(record)?);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let sealed = cipher(root, scope, collection)?
        .encrypt(
            &nonce,
            Payload {
                msg: &plain,
                aad: &aad(scope, collection, &key, version)?,
            },
        )
        .map_err(|_| Error::Unlock)?;
    let mut out = Vec::with_capacity(12 + sealed.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Opens a record read from the server and checks it is the record the
/// server filed it under.
pub fn open(
    root: &VaultRoot,
    scope: &VaultScope,
    collection: &str,
    key: &str,
    version: u64,
    sealed: &[u8],
) -> Result<ViewRecord> {
    if sealed.len() < 28 {
        return Err(Error::Invalid);
    }
    let plain = zeroize::Zeroizing::new(
        cipher(root, scope, collection)?
            .decrypt(
                Nonce::from_slice(&sealed[..12]),
                Payload {
                    msg: &sealed[12..],
                    aad: &aad(scope, collection, key, version)?,
                },
            )
            .map_err(|_| Error::Identity)?,
    );
    let record: ViewRecord = serde_json::from_slice(&plain)?;
    if record_key(root, scope, collection, &record.id)? != key {
        return Err(Error::Identity);
    }
    Ok(record)
}

/// A record as the server last confirmed it. `None` is a deletion.
#[derive(Clone, Serialize, Deserialize)]
pub struct Confirmed {
    pub version: u64,
    pub record: Option<ViewRecord>,
}

/// One collection on this machine: what the server confirmed, and this
/// machine's writes it has not accepted yet. Persisted sealed, whole.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Collection {
    /// Server sequence read through.
    pub cursor: u64,
    pub confirmed: BTreeMap<String, Confirmed>,
    /// Keyed id → the record to write (`None` deletes).
    pub pending: BTreeMap<String, Option<ViewRecord>>,
    /// The collection has been pulled completely at least once.
    #[serde(default)]
    pub loaded: bool,
}

/// One write to send: the keyed id, the version it replaces, and the record.
pub struct Write {
    pub key: String,
    pub base_version: u64,
    pub record: Option<ViewRecord>,
}

impl Collection {
    /// What the UI shows: confirmed records with pending writes on top.
    pub fn view(&self) -> Vec<ViewRecord> {
        let mut out: BTreeMap<&str, &ViewRecord> = self
            .confirmed
            .iter()
            .filter_map(|(key, c)| c.record.as_ref().map(|r| (key.as_str(), r)))
            .collect();
        for (key, record) in &self.pending {
            match record {
                Some(record) => out.insert(key, record),
                None => out.remove(key.as_str()),
            };
        }
        out.into_values().cloned().collect()
    }

    /// Whether a record with this keyed id was deleted (by anyone) and the
    /// deletion is confirmed.
    pub fn deleted(&self, key: &str) -> bool {
        self.confirmed.get(key).is_some_and(|c| c.record.is_none())
    }

    pub fn write(&mut self, key: String, record: Option<ViewRecord>) {
        self.pending.insert(key, record);
    }

    pub fn outgoing(&self) -> Vec<Write> {
        self.pending
            .iter()
            .map(|(key, record)| Write {
                key: key.clone(),
                base_version: self.confirmed.get(key).map_or(0, |c| c.version),
                record: record.clone(),
            })
            .collect()
    }

    /// A pulled row. A full re-read (`reset`) starts from nothing confirmed.
    pub fn pulled(&mut self, key: String, version: u64, record: Option<ViewRecord>) {
        if self.confirmed.get(&key).is_some_and(|c| c.version >= version) {
            return;
        }
        self.settle(&key, record.as_ref());
        self.confirmed.insert(key, Confirmed { version, record });
    }

    /// The server's answer to one write.
    pub fn answered(&mut self, key: &str, applied: bool, version: u64, current: Option<Confirmed>) {
        if applied {
            if let Some(record) = self.pending.remove(key) {
                self.confirmed.insert(key.to_owned(), Confirmed { version, record });
            }
            return;
        }
        // Lost: keep the server's copy and retry on it, unless someone
        // deleted the record, which an edit never undoes.
        let current = current.unwrap_or(Confirmed {
            version,
            record: None,
        });
        self.settle(key, current.record.as_ref());
        if current.version > 0 {
            self.confirmed.insert(key.to_owned(), current);
        }
    }

    /// Drops a pending write the server state has made moot: it already
    /// holds the same record, or it deleted what the write would edit.
    fn settle(&mut self, key: &str, server: Option<&ViewRecord>) {
        let moot = match (self.pending.get(key), server) {
            (Some(Some(mine)), Some(theirs)) => mine.fields == theirs.fields && mine.kind == theirs.kind,
            (Some(Some(_)), None) => self.confirmed.get(key).is_some_and(|c| c.record.is_some()),
            (Some(None), None) => true,
            _ => false,
        };
        if moot {
            self.pending.remove(key);
        }
    }
}

/// Wire forms of the server's collection frames.
pub mod wire {
    use serde::{Deserialize, Serialize};

    use crate::workspace::protocol::b64;

    #[derive(Serialize)]
    pub struct Write {
        pub key: String,
        pub base_version: u64,
        /// `None` deletes.
        #[serde(with = "b64::option")]
        pub ciphertext: Option<Vec<u8>>,
    }

    #[derive(Deserialize)]
    pub struct Record {
        pub key: String,
        pub version: u64,
        #[serde(with = "b64::option", default)]
        pub ciphertext: Option<Vec<u8>>,
    }

    #[derive(Deserialize)]
    pub struct Listing {
        pub collection: String,
        pub records: Vec<Record>,
        pub cursor: u64,
        pub more: bool,
        pub reset: bool,
    }

    #[derive(Deserialize)]
    pub struct Answer {
        pub key: String,
        pub applied: bool,
        pub version: u64,
        #[serde(default)]
        pub current: Option<Record>,
    }
}

#[cfg(test)]
#[path = "collections_tests.rs"]
mod tests;
