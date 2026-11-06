//! Everything a profile keeps (bookmarks, passwords, downloads, tabs, cookies) as encrypted
//! records in one local database, whether or not a vault exists. Rows are sealed with a key
//! kept for this install alone; the vault link re-seals them under the vault root to upload,
//! so creating, pausing or destroying a vault never touches what is stored here.
//!
//! One row per record. A row is `dirty` while it has a change the server has not accepted,
//! and carries the server version it was last confirmed at (0: the server never had it).
use std::path::Path;

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use zeroize::Zeroizing;

use crate::{document::ViewRecord, Error, Result};

const NONCE: usize = 12;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS records (
    profile TEXT NOT NULL,
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    sealed BLOB,
    edited_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    dirty INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (profile, collection, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS records_dirty ON records(dirty, edited_at);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
";

/// The install's key for this database. It never leaves the machine.
pub struct LocalKey(Zeroizing<[u8; 32]>);

impl LocalKey {
    pub fn generate() -> Self {
        let mut key = Zeroizing::new([0; 32]);
        OsRng.fill_bytes(key.as_mut());
        Self(key)
    }

    pub(crate) fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != 32 {
            return Err(Error::SecureStorage);
        }
        let mut key = Zeroizing::new([0; 32]);
        key.copy_from_slice(bytes);
        Ok(Self(key))
    }

    pub(crate) fn bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// A change waiting to go to the server.
pub struct DirtyRow {
    pub profile: String,
    pub collection: String,
    pub id: String,
    /// The record's JSON; `None` is a deletion.
    pub plaintext: Option<Zeroizing<Vec<u8>>>,
    pub edited_at: u64,
    pub version: u64,
}

/// What a server copy did to the local row.
#[derive(Debug, PartialEq, Eq)]
pub enum Applied {
    /// The server's copy replaced the local one.
    Replaced,
    /// The local edit is newer: it stays, and goes out on the server's version.
    KeptLocal,
    /// The server sent a version this machine has already moved past.
    Ignored,
}

#[derive(Default, Serialize, Debug, PartialEq, Eq)]
pub struct Totals {
    pub records: u64,
    pub waiting: u64,
}

pub struct LocalStore {
    connection: Connection,
    cipher: Aes256Gcm,
    /// The latest edit time this store has seen, from any machine.
    clock: u64,
}

fn aad(profile: &str, collection: &str, id: &str) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "misty.local-record.v1",
        profile,
        collection,
        id,
    ))?)
}

const DELETES_KEPT_MS: u64 = 90 * 24 * 60 * 60 * 1000;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

impl LocalStore {
    pub fn open(path: &Path, key: &LocalKey) -> Result<Self> {
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(path)
            .map_err(|_| Error::Storage(rusqlite::Error::InvalidPath(path.into())))?;
        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
        connection.execute_batch(SCHEMA)?;
        // The server forgets a deletion after this long; so can this computer.
        connection.execute(
            "DELETE FROM records WHERE sealed IS NULL AND dirty = 0 AND edited_at < ?1",
            params![now_ms().saturating_sub(DELETES_KEPT_MS) as i64],
        )?;
        let cipher = Aes256Gcm::new_from_slice(key.bytes()).map_err(|_| Error::Invalid)?;
        let clock = connection
            .query_row("SELECT COALESCE(MAX(edited_at), 0) FROM records", [], |r| {
                r.get::<_, i64>(0)
            })? as u64;
        Ok(Self {
            connection,
            cipher,
            clock,
        })
    }

    /// An edit time that is never behind anything this store has seen, so a machine with a
    /// slow clock still orders its new edits after what it just received.
    fn tick(&mut self) -> u64 {
        self.clock = now_ms().max(self.clock + 1);
        self.clock
    }

    fn seal(&self, profile: &str, collection: &str, id: &str, plain: &[u8]) -> Result<Vec<u8>> {
        let mut nonce = [0; NONCE];
        OsRng.fill_bytes(&mut nonce);
        let aad = aad(profile, collection, id)?;
        let sealed = self
            .cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: plain,
                    aad: &aad,
                },
            )
            .map_err(|_| Error::Unlock)?;
        let mut out = Vec::with_capacity(NONCE + sealed.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        Ok(out)
    }

    fn open_row(
        &self,
        profile: &str,
        collection: &str,
        id: &str,
        sealed: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>> {
        if sealed.len() < NONCE {
            return Err(Error::Invalid);
        }
        let aad = aad(profile, collection, id)?;
        self.cipher
            .decrypt(
                Nonce::from_slice(&sealed[..NONCE]),
                Payload {
                    msg: &sealed[NONCE..],
                    aad: &aad,
                },
            )
            .map(Zeroizing::new)
            .map_err(|_| Error::Unlock)
    }

    /// A collection's live records. A row this version can't read (written by a newer one, or
    /// damaged) is skipped here and left in place, so it is never lost or passed off as gone.
    pub fn list(&self, profile: &str, collection: &str) -> Result<Vec<ViewRecord>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT id, sealed FROM records
             WHERE profile = ?1 AND collection = ?2 AND sealed IS NOT NULL",
        )?;
        let rows = statement
            .query_map(params![profile, collection], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows
            .into_iter()
            .filter_map(|(id, sealed)| {
                let plain = self.open_row(profile, collection, &id, &sealed).ok()?;
                serde_json::from_slice(&plain).ok()
            })
            .collect())
    }

    /// Ids deleted in a collection, here or elsewhere, and still remembered.
    pub fn deleted_ids(&self, profile: &str, collection: &str) -> Result<Vec<String>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT id FROM records WHERE profile = ?1 AND collection = ?2 AND sealed IS NULL",
        )?;
        let rows = statement
            .query_map(params![profile, collection], |row| row.get(0))?
            .collect::<std::result::Result<Vec<String>, _>>()?;
        Ok(rows)
    }

    pub fn get(&self, profile: &str, collection: &str, id: &str) -> Result<Option<ViewRecord>> {
        let sealed: Option<Option<Vec<u8>>> = self
            .connection
            .query_row(
                "SELECT sealed FROM records WHERE profile = ?1 AND collection = ?2 AND id = ?3",
                params![profile, collection, id],
                |row| row.get(0),
            )
            .optional()?;
        match sealed.flatten() {
            Some(sealed) => {
                let plain = self.open_row(profile, collection, id, &sealed)?;
                Ok(Some(serde_json::from_slice(&plain)?))
            }
            None => Ok(None),
        }
    }

    /// Local edits. `None` deletes. Writing what is already stored changes nothing, so a
    /// repeated save never sends anything. Returns how many rows changed.
    pub fn write(
        &mut self,
        profile: &str,
        collection: &str,
        writes: Vec<(String, Option<ViewRecord>)>,
    ) -> Result<usize> {
        let mut changed = 0;
        for (id, record) in writes {
            let plain = match &record {
                Some(record) => Some(Zeroizing::new(serde_json::to_vec(record)?)),
                None => None,
            };
            if self.write_one(profile, collection, &id, plain.as_deref().map(Vec::as_slice))? {
                changed += 1;
            }
        }
        Ok(changed)
    }

    /// A local edit of an opaque record body. Returns whether the row changed.
    pub fn write_one(
        &mut self,
        profile: &str,
        collection: &str,
        id: &str,
        plain: Option<&[u8]>,
    ) -> Result<bool> {
        let row: Option<(Option<Vec<u8>>, u64)> = self
            .connection
            .query_row(
                "SELECT sealed, version FROM records
                 WHERE profile = ?1 AND collection = ?2 AND id = ?3",
                params![profile, collection, id],
                |row| Ok((row.get(0)?, row.get::<_, i64>(1)? as u64)),
            )
            .optional()?;
        let current = match row.as_ref().and_then(|(sealed, _)| sealed.as_ref()) {
            Some(sealed) => Some(self.open_row(profile, collection, id, sealed)?),
            None => None,
        };
        if current.as_ref().map(|plain| plain.as_slice()) == plain {
            return Ok(false);
        }
        let version = row.as_ref().map_or(0, |(_, version)| *version);
        // The server never had it, so there is nothing to tell it: the row just goes.
        if plain.is_none() && version == 0 {
            self.connection.execute(
                "DELETE FROM records WHERE profile = ?1 AND collection = ?2 AND id = ?3",
                params![profile, collection, id],
            )?;
            return Ok(true);
        }
        let sealed = plain
            .map(|plain| self.seal(profile, collection, id, plain))
            .transpose()?;
        let edited_at = self.tick();
        self.connection.execute(
            "INSERT INTO records (profile, collection, id, sealed, edited_at, version, dirty)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
             ON CONFLICT (profile, collection, id) DO UPDATE SET
               sealed = excluded.sealed, edited_at = excluded.edited_at, dirty = 1",
            params![profile, collection, id, sealed, edited_at as i64, version as i64],
        )?;
        Ok(true)
    }

    /// The oldest changes waiting to go to the server. A row that can't be opened is left out
    /// and stays dirty, so one damaged row never holds back the others.
    pub fn dirty(&self, limit: usize) -> Result<Vec<DirtyRow>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT profile, collection, id, sealed, edited_at, version FROM records
             WHERE dirty = 1 ORDER BY edited_at LIMIT ?1",
        )?;
        let rows = statement
            .query_map(params![limit as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<Vec<u8>>>(3)?,
                    row.get::<_, i64>(4)? as u64,
                    row.get::<_, i64>(5)? as u64,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows
            .into_iter()
            .filter_map(|(profile, collection, id, sealed, edited_at, version)| {
                let plaintext = match sealed {
                    Some(sealed) => Some(self.open_row(&profile, &collection, &id, &sealed).ok()?),
                    None => None,
                };
                Some(DirtyRow {
                    profile,
                    collection,
                    id,
                    plaintext,
                    edited_at,
                    version,
                })
            })
            .collect())
    }

    /// What to send next: everything people notice first, history last. `with_history` holds
    /// history back until its slower batch is due. A row set aside is left out.
    pub fn dirty_for_push(&self, limit: usize, with_history: bool) -> Result<Vec<DirtyRow>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT profile, collection, id, sealed, edited_at, version FROM records
             WHERE dirty = 1 AND (?2 OR collection <> 'history')
             ORDER BY CASE collection
                 WHEN 'profiles' THEN 0
                 WHEN 'tabs' THEN 1
                 WHEN 'tab_groups' THEN 1
                 WHEN 'bookmarks' THEN 2
                 WHEN 'cookies' THEN 3
                 WHEN 'passwords' THEN 3
                 WHEN 'autofill' THEN 3
                 WHEN 'history' THEN 9
                 ELSE 5 END, edited_at
             LIMIT ?1",
        )?;
        let rows = statement
            .query_map(params![limit as i64, with_history], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<Vec<u8>>>(3)?,
                    row.get::<_, i64>(4)? as u64,
                    row.get::<_, i64>(5)? as u64,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut out = Vec::with_capacity(rows.len());
        for (profile, collection, id, sealed, edited_at, version) in rows {
            let plaintext = match sealed {
                Some(sealed) => match self.open_row(&profile, &collection, &id, &sealed) {
                    Ok(plain) => Some(plain),
                    // Damaged here: nothing to send, ever. It must not block what's behind it.
                    Err(_) => {
                        self.set_aside(&profile, &collection, &id)?;
                        continue;
                    }
                },
                None => None,
            };
            out.push(DirtyRow {
                profile,
                collection,
                id,
                plaintext,
                edited_at,
                version,
            });
        }
        Ok(out)
    }

    /// Stops trying to send a record that can't be sent. It stays usable here and is listed in
    /// Settings, and its next edit tries again.
    pub fn set_aside(&self, profile: &str, collection: &str, id: &str) -> Result<()> {
        self.connection.execute(
            "UPDATE records SET dirty = 2 WHERE profile = ?1 AND collection = ?2 AND id = ?3",
            params![profile, collection, id],
        )?;
        Ok(())
    }

    /// How many records were set aside, by collection.
    pub fn set_aside_counts(&self) -> Result<Vec<(String, u64)>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT collection, COUNT(*) FROM records WHERE dirty = 2 GROUP BY collection",
        )?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get::<_, i64>(1)? as u64)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// The server holds a copy nobody can read: this row's edit will replace it.
    pub fn rebase(&self, profile: &str, collection: &str, id: &str, version: u64) -> Result<()> {
        self.connection.execute(
            "UPDATE records SET version = ?4 WHERE profile = ?1 AND collection = ?2 AND id = ?3",
            params![profile, collection, id, version as i64],
        )?;
        Ok(())
    }

    /// The server's listing is starting from nothing because this session was away past what it
    /// keeps. Rows it mentions get the mark cleared; `finish_full_listing` then drops what it
    /// never mentioned. A row with a local change is kept, whatever the server says.
    pub fn begin_full_listing(&self) -> Result<()> {
        self.connection.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS listed (profile TEXT, collection TEXT, id TEXT,
                 PRIMARY KEY (profile, collection, id));
             DELETE FROM temp.listed;",
        )?;
        self.set_meta("vault.listing", "1")
    }

    pub fn finish_full_listing(&self) -> Result<()> {
        self.connection.execute(
            "DELETE FROM records WHERE dirty = 0 AND version > 0 AND NOT EXISTS (
                 SELECT 1 FROM temp.listed l WHERE l.profile = records.profile
                     AND l.collection = records.collection AND l.id = records.id)",
            [],
        )?;
        self.connection.execute("DELETE FROM meta WHERE key = 'vault.listing'", [])?;
        self.connection.execute("DELETE FROM temp.listed", [])?;
        Ok(())
    }

    /// The server accepted a change at `version`. A newer edit made meanwhile stays dirty.
    pub fn accepted(
        &mut self,
        profile: &str,
        collection: &str,
        id: &str,
        edited_at: u64,
        version: u64,
    ) -> Result<()> {
        self.connection.execute(
            "UPDATE records
             SET version = ?5, dirty = CASE WHEN edited_at = ?4 THEN 0 ELSE dirty END
             WHERE profile = ?1 AND collection = ?2 AND id = ?3 AND version <= ?5",
            params![profile, collection, id, edited_at as i64, version as i64],
        )?;
        Ok(())
    }

    /// A copy from the server. The newer edit wins; a local edit that wins goes out next, on
    /// the server's version. A version this machine has passed is refused, so a server can't
    /// roll a record back.
    pub fn apply_remote(
        &mut self,
        profile: &str,
        collection: &str,
        id: &str,
        version: u64,
        edited_at: u64,
        plain: Option<&[u8]>,
    ) -> Result<Applied> {
        self.clock = self.clock.max(edited_at);
        if self.meta("vault.listing")?.is_some() {
            self.connection.execute(
                "INSERT OR IGNORE INTO temp.listed (profile, collection, id) VALUES (?1, ?2, ?3)",
                params![profile, collection, id],
            )?;
        }
        let row: Option<(u64, u64, bool)> = self
            .connection
            .query_row(
                "SELECT version, edited_at, dirty FROM records
                 WHERE profile = ?1 AND collection = ?2 AND id = ?3",
                params![profile, collection, id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)? as u64,
                        row.get::<_, i64>(1)? as u64,
                        row.get::<_, i64>(2)? != 0,
                    ))
                },
            )
            .optional()?;
        if let Some((local_version, local_edit, dirty)) = row {
            if version < local_version {
                return Ok(Applied::Ignored);
            }
            if dirty && local_edit > edited_at {
                self.connection.execute(
                    "UPDATE records SET version = ?4
                     WHERE profile = ?1 AND collection = ?2 AND id = ?3",
                    params![profile, collection, id, version as i64],
                )?;
                return Ok(Applied::KeptLocal);
            }
            if !dirty && version == local_version {
                return Ok(Applied::Ignored);
            }
        }
        let sealed = plain
            .map(|plain| self.seal(profile, collection, id, plain))
            .transpose()?;
        self.connection.execute(
            "INSERT INTO records (profile, collection, id, sealed, edited_at, version, dirty)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
             ON CONFLICT (profile, collection, id) DO UPDATE SET
               sealed = excluded.sealed, edited_at = excluded.edited_at,
               version = excluded.version, dirty = 0",
            params![profile, collection, id, sealed, edited_at as i64, version as i64],
        )?;
        Ok(Applied::Replaced)
    }

    /// Leaves the vault behind: every live record is local again and would upload to a new
    /// vault from scratch, and deletions the old server needed are forgotten.
    pub fn unlink(&mut self) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("DELETE FROM records WHERE sealed IS NULL", [])?;
        tx.execute("UPDATE records SET version = 0, dirty = 1", [])?;
        tx.execute(
            "DELETE FROM meta WHERE key LIKE 'vault.%' OR key LIKE 'secret.%'",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Everything a deleted profile kept.
    pub fn remove_profile(&mut self, profile: &str) -> Result<()> {
        self.connection.execute(
            "DELETE FROM records WHERE profile = ?1",
            params![profile],
        )?;
        self.forget_profile_meta(profile)
    }

    /// Notes kept about a profile under `<kind>.<profile>`, sealed or not.
    fn forget_profile_meta(&self, profile: &str) -> Result<()> {
        let mut statement = self.connection.prepare_cached("SELECT key FROM meta")?;
        let keys = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let suffix = format!(".{profile}");
        for key in keys.iter().filter(|key| key.ends_with(&suffix)) {
            self.connection
                .execute("DELETE FROM meta WHERE key = ?1", params![key])?;
        }
        Ok(())
    }

    /// Deletes a profile for every session: what's on the server is marked for deletion, what never
    /// left goes now.
    pub fn erase_profile(&mut self, profile: &str) -> Result<()> {
        let edited_at = self.tick();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "DELETE FROM records WHERE profile = ?1 AND version = 0",
            params![profile],
        )?;
        tx.execute(
            "UPDATE records SET sealed = NULL, edited_at = ?2, dirty = 1 WHERE profile = ?1",
            params![profile, edited_at as i64],
        )?;
        tx.commit()?;
        self.forget_profile_meta(profile)
    }

    /// What's waiting to go, and what was set aside. Both are read from an index: this runs often.
    pub fn waiting(&self) -> Result<(u64, u64)> {
        let count = |state: i64| -> Result<u64> {
            Ok(self.connection.query_row(
                "SELECT COUNT(*) FROM records WHERE dirty = ?1",
                params![state],
                |row| row.get::<_, i64>(0),
            )? as u64)
        };
        Ok((count(1)?, count(2)?))
    }

    pub fn totals(&self) -> Result<Totals> {
        Ok(self.connection.query_row(
            "SELECT COUNT(*), COALESCE(SUM(dirty = 1), 0) FROM records WHERE sealed IS NOT NULL OR dirty = 1",
            [],
            |row| {
                Ok(Totals {
                    records: row.get::<_, i64>(0)? as u64,
                    waiting: row.get::<_, i64>(1)? as u64,
                })
            },
        )?)
    }

    /// Runs `work` in one transaction: a page of a thousand records is one disk sync, and a crash
    /// halfway leaves everything as it was, cursor included.
    pub fn atomic<T>(&mut self, work: impl FnOnce(&mut Self) -> Result<T>) -> Result<T> {
        self.connection.execute_batch("BEGIN IMMEDIATE")?;
        match work(self) {
            Ok(value) => {
                self.connection.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.connection.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Adds to what this session has sent and received today.
    pub fn add_traffic(&self, now_ms: u64, sent: u64, received: u64) -> Result<()> {
        let key = format!("traffic.{}", now_ms / 86_400_000);
        let (old_sent, old_received) = self
            .meta(&key)?
            .and_then(|value| serde_json::from_str::<(u64, u64)>(&value).ok())
            .unwrap_or_default();
        self.set_meta(
            &key,
            &serde_json::to_string(&(old_sent + sent, old_received + received))?,
        )?;
        // Older days aren't shown.
        let oldest = now_ms / 86_400_000;
        self.connection.execute(
            "DELETE FROM meta WHERE key LIKE 'traffic.%'
             AND CAST(substr(key, 9) AS INTEGER) < ?1",
            params![oldest.saturating_sub(31) as i64],
        )?;
        Ok(())
    }

    /// What this session sent and received over the last 30 days.
    pub fn traffic(&self, now_ms: u64) -> Result<(u64, u64)> {
        let today = (now_ms / 86_400_000) as i64;
        let mut statement = self.connection.prepare_cached(
            "SELECT value FROM meta WHERE key LIKE 'traffic.%'
             AND CAST(substr(key, 9) AS INTEGER) > ?1",
        )?;
        let rows = statement
            .query_map(params![today - 30], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows
            .iter()
            .filter_map(|value| serde_json::from_str::<(u64, u64)>(value).ok())
            .fold((0, 0), |(sent, received), (a, b)| (sent + a, received + b)))
    }

    /// A small secret kept with the database, sealed under its key: this session's signing key.
    pub fn set_secret(&self, name: &str, value: &[u8]) -> Result<()> {
        let sealed = self.seal("", "secret", name, value)?;
        self.set_meta(
            &format!("secret.{name}"),
            &sealed.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        )
    }

    pub fn secret(&self, name: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
        let Some(hex) = self.meta(&format!("secret.{name}"))? else {
            return Ok(None);
        };
        let bytes = (0..hex.len())
            .step_by(2)
            .map(|i| {
                hex.get(i..i + 2)
                    .and_then(|pair| u8::from_str_radix(pair, 16).ok())
                    .ok_or(Error::Invalid)
            })
            .collect::<Result<Vec<u8>>>()?;
        self.open_row("", "secret", name, &bytes).map(Some)
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .connection
            .query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
                r.get(0)
            })
            .optional()?)
    }

    pub fn delete_meta(&self, key: &str) -> Result<()> {
        self.connection
            .execute("DELETE FROM meta WHERE key = ?1", params![key])?;
        Ok(())
    }

    /// A record's body, as stored.
    pub fn read_raw(
        &self,
        profile: &str,
        collection: &str,
        id: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>> {
        let sealed: Option<Option<Vec<u8>>> = self
            .connection
            .query_row(
                "SELECT sealed FROM records WHERE profile = ?1 AND collection = ?2 AND id = ?3",
                params![profile, collection, id],
                |row| row.get(0),
            )
            .optional()?;
        sealed
            .flatten()
            .map(|sealed| self.open_row(profile, collection, id, &sealed))
            .transpose()
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.connection.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
