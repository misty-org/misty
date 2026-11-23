use std::path::Path;

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use rand::{rand_core::UnwrapErr, rngs::SysRng, Rng};
use rusqlite::{params, Connection, OptionalExtension};
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

pub struct LocalKey(Zeroizing<[u8; 32]>);

impl LocalKey {
    pub fn generate() -> Self {
        let mut key = Zeroizing::new([0; 32]);
        UnwrapErr(SysRng).fill_bytes(key.as_mut());
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

pub struct LocalStore {
    connection: Connection,
    cipher: Aes256Gcm,
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
        connection.execute(
            "DELETE FROM records WHERE sealed IS NULL AND dirty = 0 AND edited_at < ?1",
            params![now_ms().saturating_sub(DELETES_KEPT_MS) as i64],
        )?;
        let cipher = Aes256Gcm::new_from_slice(key.bytes()).map_err(|_| Error::Invalid)?;
        let clock =
            connection.query_row("SELECT COALESCE(MAX(edited_at), 0) FROM records", [], |r| {
                r.get::<_, i64>(0)
            })? as u64;
        Ok(Self {
            connection,
            cipher,
            clock,
        })
    }

    fn tick(&mut self) -> u64 {
        self.clock = now_ms().max(self.clock + 1);
        self.clock
    }

    fn seal(&self, profile: &str, collection: &str, id: &str, plain: &[u8]) -> Result<Vec<u8>> {
        let mut nonce = [0; NONCE];
        UnwrapErr(SysRng).fill_bytes(&mut nonce);
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
            if self.write_one(
                profile,
                collection,
                &id,
                plain.as_deref().map(Vec::as_slice),
            )? {
                changed += 1;
            }
        }
        Ok(changed)
    }

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
            params![
                profile,
                collection,
                id,
                sealed,
                edited_at as i64,
                version as i64
            ],
        )?;
        Ok(true)
    }

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
}

mod notes;

#[cfg(test)]
mod tests;
